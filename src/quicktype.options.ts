import * as fs from "node:fs";
import * as path from "node:path";

import { definedMap, withDefault } from "collection-utils";
import _wordwrap from "wordwrap";

import {
    type Options,
    type TargetLanguage,
    defaultTargetLanguages,
    defined,
    getStream,
    inferenceFlagNames,
    isLanguageName,
    languageNamed,
    messageError,
    parseJSON,
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
import { makeInputData } from "./input";
import { getSources, makeTypeScriptSource } from "./sources";
import { displayUsage } from "./usage";
import {
    negatedInferenceFlagName,
    stringSourceDataToStreamSourceData,
    typeNameFromFilename,
} from "./utils";
import type { CLIOptions } from "./CLIOptions.types";

const packageJSON = require("../package.json");

const wordWrap: (s: string) => string = _wordwrap(90);

export async function makeQuicktypeOptions(
    options: CLIOptions,
    targetLanguages?: TargetLanguage[],
): Promise<Partial<Options> | undefined> {
    if (options.help) {
        displayUsage(targetLanguages ?? defaultTargetLanguages);
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
        const markovChain = trainMarkovChain(lines, 3);
        console.log(JSON.stringify(markovChain));
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

            const graphqlSources: GraphQLTypeSource[] = [];
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
                graphqlSources.push({ kind: "graphql", name, schema, query });
            }

            sources = graphqlSources;
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
                const collectionJson = fs.readFileSync(collectionFile, "utf8");
                const { sources: postmanSources, description } =
                    sourcesFromPostmanCollection(
                        collectionJson,
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
        const negatedValue = options[cliName];
        const positiveValue = options[flagName];
        const value = !(positiveValue == null)
            ? positiveValue
            : !(negatedValue == null)
              ? negatedValue
              : undefined;

        if (typeof value === "boolean") {
            quicktypeOptions[flagName] = !value;
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
