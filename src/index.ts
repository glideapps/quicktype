#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";

import chalk from "chalk";
import { definedMap, withDefault } from "collection-utils";
import * as _ from "lodash";
import _wordwrap from "wordwrap";

import {
    IssueAnnotationData,
    type Options,
    type SerializedRenderResult,
    type TargetLanguage,
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

import { introspectServer } from "./GraphQLIntrospection";
import type {
    GraphQLTypeSource,
    JSONTypeSource,
    TypeSource,
} from "./TypeSource";
import { parseCLIOptions } from "./cli.options";
import { inferCLIOptions } from "./inference";
import {
    negatedInferenceFlagName,
    stringSourceDataToStreamSourceData,
    typeNameFromFilename,
} from "./utils";
import type { CLIOptions } from "./CLIOptions.types";
import { getSources, makeTypeScriptSource } from "./sources";
import { usage } from "./usage";
import { makeInputData } from "./input";

const packageJSON = require("../package.json");

const wordWrap: (s: string) => string = _wordwrap(90);

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
