#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";

import chalk from "chalk";
import { definedMap, withDefault } from "collection-utils";
import getUsage from "command-line-usage";
import * as _ from "lodash";
import type { Readable } from "readable-stream";
import stringToStream from "string-to-stream";
import _wordwrap from "wordwrap";

import {
    FetchingJSONSchemaStore,
    InputData,
    IssueAnnotationData,
    JSONInput,
    JSONSchemaInput,
    type JSONSourceData,
    type OptionDefinition,
    type Options,
    type SerializedRenderResult,
    type TargetLanguage,
    assertNever,
    defaultTargetLanguages,
    defined,
    getStream,
    inferenceFlagNames,
    isLanguageName,
    languageNamed,
    messageError,
    parseJSON,
    quicktypeMultiFile,
    readableFromFileOrURL,
    sourcesFromPostmanCollection,
    trainMarkovChain,
} from "quicktype-core";
import { GraphQLInput } from "quicktype-graphql-input";

import { CompressedJSONFromStream } from "./CompressedJSONFromStream";
import { introspectServer } from "./GraphQLIntrospection";
import type {
    GraphQLTypeSource,
    JSONTypeSource,
    TypeSource,
} from "./TypeSource";
import { parseCLIOptions } from "./cli.options";
import { inferCLIOptions } from "./inference";
import { makeOptionDefinitions } from "./optionDefinitions";
import {
    makeLangTypeLabel,
    negatedInferenceFlagName,
    typeNameFromFilename,
} from "./utils";
import type { CLIOptions } from "./CLIOptions.types";
import { getSources, makeTypeScriptSource } from "./sources";

const packageJSON = require("../package.json");

const wordWrap: (s: string) => string = _wordwrap(90);

interface ColumnDefinition {
    name: string;
    padding?: { left: string; right: string };
    width?: number;
}

interface TableOptions {
    columns: ColumnDefinition[];
}

interface UsageSection {
    content?: string | string[];
    header?: string;
    hide?: string[];
    optionList?: OptionDefinition[];
    tableOptions?: TableOptions;
}

const tableOptionsForOptions: TableOptions = {
    columns: [
        {
            name: "option",
            width: 60,
        },
        {
            name: "description",
            width: 60,
        },
    ],
};

function makeSectionsBeforeRenderers(
    targetLanguages: readonly TargetLanguage[],
): UsageSection[] {
    const langDisplayNames = targetLanguages
        .map((r) => r.displayName)
        .join(", ");

    return [
        {
            header: "Synopsis",
            content: [
                `$ quicktype [${chalk.bold("--lang")} LANG] [${chalk.bold("--src-lang")} SRC_LANG] [${chalk.bold(
                    "--out",
                )} FILE] FILE|URL ...`,
                "",
                `  LANG ... ${makeLangTypeLabel(targetLanguages)}`,
                "",
                "SRC_LANG ... json|schema|graphql|postman|typescript",
            ],
        },
        {
            header: "Description",
            content: `Given JSON sample data, quicktype outputs code for working with that data in ${langDisplayNames}.`,
        },
        {
            header: "Options",
            optionList: makeOptionDefinitions(targetLanguages),
            hide: ["no-render", "build-markov-chain"],
            tableOptions: tableOptionsForOptions,
        },
    ];
}

const sectionsAfterRenderers: UsageSection[] = [
    {
        header: "Examples",
        content: [
            chalk.dim("Generate C# to parse a Bitcoin API"),
            "$ quicktype -o LatestBlock.cs https://blockchain.info/latestblock",
            "",
            chalk.dim(
                "Generate Go code from a directory of samples containing:",
            ),
            chalk.dim(
                `  - Foo.json
  + Bar
    - bar-sample-1.json
    - bar-sample-2.json
  - Baz.url`,
            ),
            "$ quicktype -l go samples",
            "",
            chalk.dim("Generate JSON Schema, then TypeScript"),
            "$ quicktype -o schema.json https://blockchain.info/latestblock",
            "$ quicktype -o bitcoin.ts --src-lang schema schema.json",
        ],
    },
    {
        content: `Learn more at ${chalk.bold("quicktype.io")}`,
    },
];

function usage(targetLanguages: readonly TargetLanguage[]): void {
    const rendererSections: UsageSection[] = [];

    for (const language of targetLanguages) {
        const definitions = language.cliOptionDefinitions.display;
        if (definitions.length === 0) continue;

        rendererSections.push({
            header: `Options for ${language.displayName}`,
            optionList: definitions,
            tableOptions: tableOptionsForOptions,
        });
    }

    const sections = _.concat(
        makeSectionsBeforeRenderers(targetLanguages),
        rendererSections,
        sectionsAfterRenderers,
    );

    console.log(getUsage(sections));
}

export function jsonInputForTargetLanguage(
    _targetLanguage: string | TargetLanguage,
    languages?: TargetLanguage[],
    handleJSONRefs = false,
): JSONInput<Readable> {
    let targetLanguage: TargetLanguage;
    if (typeof _targetLanguage === "string") {
        const languageName = isLanguageName(_targetLanguage)
            ? _targetLanguage
            : "typescript";
        targetLanguage = defined(languageNamed(languageName, languages));
    } else {
        targetLanguage = _targetLanguage;
    }

    const compressedJSON = new CompressedJSONFromStream(
        targetLanguage.dateTimeRecognizer,
        handleJSONRefs,
    );
    return new JSONInput(compressedJSON);
}

async function makeInputData(
    sources: TypeSource[],
    targetLanguage: TargetLanguage,
    additionalSchemaAddresses: readonly string[],
    handleJSONRefs: boolean,
    httpHeaders?: string[],
): Promise<InputData> {
    const inputData = new InputData();

    for (const source of sources) {
        switch (source.kind) {
            case "graphql":
                await inputData.addSource(
                    "graphql",
                    source,
                    () => new GraphQLInput(),
                );
                break;
            case "json":
                await inputData.addSource("json", source, () =>
                    jsonInputForTargetLanguage(
                        targetLanguage,
                        undefined,
                        handleJSONRefs,
                    ),
                );
                break;
            case "schema":
                await inputData.addSource(
                    "schema",
                    source,
                    () =>
                        new JSONSchemaInput(
                            new FetchingJSONSchemaStore(httpHeaders),
                            [],
                            additionalSchemaAddresses,
                        ),
                );
                break;
            default:
                return assertNever(source);
        }
    }

    return inputData;
}

function stringSourceDataToStreamSourceData(
    src: JSONSourceData<string>,
): JSONSourceData<Readable> {
    return {
        name: src.name,
        description: src.description,
        samples: src.samples.map(
            (sample) => stringToStream(sample) as Readable,
        ),
    };
}

export async function makeQuicktypeOptions(
    options: CLIOptions,
    targetLanguages?: TargetLanguage[],
): Promise<Partial<Options> | undefined> {
    if (options.help) {
        usage(targetLanguages ?? defaultTargetLanguages);
        return;
    }

    if (options.version) {
        console.log(`quicktype version ${packageJSON.version}`);
        console.log("Visit quicktype.io for more info.");
        return;
    }

    if (options.buildMarkovChain !== undefined) {
        const contents = fs.readFileSync(options.buildMarkovChain).toString();
        const lines = contents.split("\n");
        const mc = trainMarkovChain(lines, 3);
        console.log(JSON.stringify(mc));
        return;
    }

    let sources: TypeSource[] = [];
    let leadingComments: string[] | undefined = undefined;
    let fixedTopLevels = false;
    switch (options.srcLang) {
        case "graphql": {
            let schemaString: string | undefined = undefined;
            let wroteSchemaToFile = false;
            if (options.graphqlIntrospect !== undefined) {
                schemaString = await introspectServer(
                    options.graphqlIntrospect,
                    withDefault(options.httpMethod, "POST"),
                    withDefault<string[]>(options.httpHeader, []),
                );
                if (options.graphqlSchema !== undefined) {
                    fs.writeFileSync(options.graphqlSchema, schemaString);
                    wroteSchemaToFile = true;
                }
            }

            const numSources = options.src.length;
            if (numSources !== 1) {
                if (wroteSchemaToFile) {
                    // We're done.
                    return;
                }

                if (numSources === 0) {
                    if (schemaString !== undefined) {
                        console.log(schemaString);
                        return;
                    }

                    return messageError("DriverNoGraphQLQueryGiven", {});
                }
            }

            const gqlSources: GraphQLTypeSource[] = [];
            for (const queryFile of options.src) {
                let schemaFileName: string | undefined = undefined;
                if (schemaString === undefined) {
                    schemaFileName = defined(options.graphqlSchema);
                    schemaString = fs.readFileSync(schemaFileName, "utf8");
                }

                const schema = parseJSON(
                    schemaString,
                    "GraphQL schema",
                    schemaFileName,
                );
                const query = await getStream(
                    await readableFromFileOrURL(queryFile, options.httpHeader),
                );
                const name =
                    numSources === 1
                        ? options.topLevel
                        : typeNameFromFilename(queryFile);
                gqlSources.push({ kind: "graphql", name, schema, query });
            }

            sources = gqlSources;
            break;
        }
        case "json":
        case "schema":
            sources = await getSources(options);
            break;
        case "typescript":
            sources = [makeTypeScriptSource(options.src)];
            break;
        case "postman":
            for (const collectionFile of options.src) {
                const collectionJSON = fs.readFileSync(collectionFile, "utf8");
                const { sources: postmanSources, description } =
                    sourcesFromPostmanCollection(
                        collectionJSON,
                        collectionFile,
                    );
                for (const src of postmanSources) {
                    sources.push(
                        Object.assign(
                            { kind: "json" },
                            stringSourceDataToStreamSourceData(src),
                        ) as JSONTypeSource,
                    );
                }

                if (postmanSources.length > 1) {
                    fixedTopLevels = true;
                }

                if (description !== undefined) {
                    leadingComments = wordWrap(description).split("\n");
                }
            }

            break;
        default:
            return messageError("DriverUnknownSourceLanguage", {
                lang: options.srcLang,
            });
    }

    const components = definedMap(options.debug, (d) => d.split(","));
    const debugAll = components?.includes("all");
    let debugPrintGraph = debugAll;
    let checkProvenance = debugAll;
    let debugPrintReconstitution = debugAll;
    let debugPrintGatherNames = debugAll;
    let debugPrintTransformations = debugAll;
    let debugPrintSchemaResolving = debugAll;
    let debugPrintTimes = debugAll;
    if (components !== undefined) {
        for (let component of components) {
            component = component.trim();
            if (component === "print-graph") {
                debugPrintGraph = true;
            } else if (component === "print-reconstitution") {
                debugPrintReconstitution = true;
            } else if (component === "print-gather-names") {
                debugPrintGatherNames = true;
            } else if (component === "print-transformations") {
                debugPrintTransformations = true;
            } else if (component === "print-times") {
                debugPrintTimes = true;
            } else if (component === "print-schema-resolving") {
                debugPrintSchemaResolving = true;
            } else if (component === "provenance") {
                checkProvenance = true;
            } else if (component !== "all") {
                return messageError("DriverUnknownDebugOption", {
                    option: component,
                });
            }
        }
    }

    if (!isLanguageName(options.lang)) {
        return messageError("DriverUnknownOutputLanguage", {
            lang: options.lang,
        });
    }

    const lang = languageNamed(options.lang, targetLanguages);

    const quicktypeOptions: Partial<Options> = {
        lang,
        alphabetizeProperties: options.alphabetizeProperties,
        allPropertiesOptional: options.allPropertiesOptional,
        fixedTopLevels,
        noRender: options.noRender,
        rendererOptions: options.rendererOptions,
        leadingComments,
        outputFilename: definedMap(options.out, path.basename),
        debugPrintGraph,
        checkProvenance,
        debugPrintReconstitution,
        debugPrintGatherNames,
        debugPrintTransformations,
        debugPrintSchemaResolving,
        debugPrintTimes,
    };
    for (const flagName of inferenceFlagNames) {
        const cliName = negatedInferenceFlagName(flagName);
        const v = options[cliName];
        if (typeof v === "boolean") {
            quicktypeOptions[flagName] = !v;
        } else {
            quicktypeOptions[flagName] = true;
        }
    }

    quicktypeOptions.inputData = await makeInputData(
        sources,
        lang,
        options.additionalSchema,
        quicktypeOptions.ignoreJsonRefs !== true,
        options.httpHeader,
    );

    return quicktypeOptions;
}

export function writeOutput(
    cliOptions: CLIOptions,
    resultsByFilename: ReadonlyMap<string, SerializedRenderResult>,
): void {
    let onFirst = true;
    for (const [filename, { lines, annotations }] of resultsByFilename) {
        const output = lines.join("\n");

        if (cliOptions.out !== undefined) {
            fs.writeFileSync(
                path.join(path.dirname(cliOptions.out), filename),
                output,
            );
        } else {
            if (!onFirst) {
                process.stdout.write("\n");
            }

            if (resultsByFilename.size > 1) {
                process.stdout.write(`// ${filename}\n\n`);
            }

            process.stdout.write(output);
        }

        if (cliOptions.quiet) {
            continue;
        }

        for (const sa of annotations) {
            const annotation = sa.annotation;
            if (!(annotation instanceof IssueAnnotationData)) continue;
            const lineNumber = sa.span.start.line;
            const humanLineNumber = lineNumber + 1;
            console.error(
                `\nIssue in line ${humanLineNumber}: ${annotation.message}`,
            );
            console.error(`${humanLineNumber}: ${lines[lineNumber]}`);
        }

        onFirst = false;
    }
}

export async function main(
    args: string[] | Partial<CLIOptions>,
): Promise<void> {
    let cliOptions: CLIOptions;
    if (Array.isArray(args)) {
        cliOptions = parseCLIOptions(args);
    } else {
        cliOptions = inferCLIOptions(args, undefined);
    }

    if (cliOptions.telemetry !== undefined) {
        switch (cliOptions.telemetry) {
            case "enable":
                break;
            case "disable":
                break;
            default:
                console.error(
                    chalk.red("telemetry must be 'enable' or 'disable'"),
                );
                return;
        }

        if (Array.isArray(args) && args.length === 2) {
            // This was merely a CLI run to set telemetry and we should not proceed
            return;
        }
    }

    const quicktypeOptions = await makeQuicktypeOptions(cliOptions);
    if (quicktypeOptions === undefined) {
        return;
    }

    const resultsByFilename = await quicktypeMultiFile(quicktypeOptions);

    writeOutput(cliOptions, resultsByFilename);
}

if (require.main === module) {
    main(process.argv.slice(2)).catch((e) => {
        if (e instanceof Error) {
            console.error(`Error: ${e.message}.`);
        } else {
            console.error(e);
        }

        process.exit(1);
    });
}
