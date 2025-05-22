#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";

import * as _ from "lodash";
import type { Readable } from "readable-stream";
import _wordwrap from "wordwrap";

import {
    assertNever,
    getStream,
    messageAssert,
    messageError,
    panic,
    parseJSON,
    readFromFileOrURL,
    readableFromFileOrURL,
} from "quicktype-core";
import { schemaForTypeScriptSources } from "quicktype-typescript-input";

import type {
    GraphQLTypeSource,
    JSONTypeSource,
    SchemaTypeSource,
    TypeSource,
} from "./TypeSource";
import { urlsFromURLGrammar } from "./URLGrammar";
import { typeNameFromFilename } from "./utils";
import type { CLIOptions } from "./CLIOptions.types";

async function sourceFromFileOrUrlArray(
    name: string,
    filesOrUrls: string[],
    httpHeaders?: string[],
): Promise<JSONTypeSource> {
    const samples = await Promise.all(
        filesOrUrls.map(
            async (file) => await readableFromFileOrURL(file, httpHeaders),
        ),
    );
    return { kind: "json", name, samples };
}

async function samplesFromDirectory(
    dataDir: string,
    httpHeaders?: string[],
): Promise<TypeSource[]> {
    async function readFilesOrURLsInDirectory(
        d: string,
    ): Promise<TypeSource[]> {
        const files = fs
            .readdirSync(d)
            .map((x) => path.join(d, x))
            .filter((x) => fs.lstatSync(x).isFile());
        // Each file is a (Name, JSON | URL)
        const sourcesInDir: TypeSource[] = [];
        const graphQLSources: GraphQLTypeSource[] = [];
        let graphQLSchema: Readable | undefined = undefined;
        let graphQLSchemaFileName: string | undefined = undefined;
        for (let file of files) {
            const name = typeNameFromFilename(file);

            let fileOrUrl = file;
            file = file.toLowerCase();

            // If file is a URL string, download it
            if (file.endsWith(".url")) {
                fileOrUrl = fs.readFileSync(file, "utf8").trim();
            }

            if (file.endsWith(".url") || file.endsWith(".json")) {
                sourcesInDir.push({
                    kind: "json",
                    name,
                    samples: [
                        await readableFromFileOrURL(fileOrUrl, httpHeaders),
                    ],
                });
            } else if (file.endsWith(".schema")) {
                sourcesInDir.push({
                    kind: "schema",
                    name,
                    uris: [fileOrUrl],
                });
            } else if (file.endsWith(".gqlschema")) {
                messageAssert(
                    graphQLSchema === undefined,
                    "DriverMoreThanOneGraphQLSchemaInDir",
                    {
                        dir: dataDir,
                    },
                );
                graphQLSchema = await readableFromFileOrURL(
                    fileOrUrl,
                    httpHeaders,
                );
                graphQLSchemaFileName = fileOrUrl;
            } else if (file.endsWith(".graphql")) {
                graphQLSources.push({
                    kind: "graphql",
                    name,
                    schema: undefined,
                    query: await getStream(
                        await readableFromFileOrURL(fileOrUrl, httpHeaders),
                    ),
                });
            }
        }

        if (graphQLSources.length > 0) {
            if (graphQLSchema === undefined) {
                return messageError("DriverNoGraphQLSchemaInDir", {
                    dir: dataDir,
                });
            }

            const schema = parseJSON(
                await getStream(graphQLSchema),
                "GraphQL schema",
                graphQLSchemaFileName,
            );
            for (const source of graphQLSources) {
                source.schema = schema;
                sourcesInDir.push(source);
            }
        }

        return sourcesInDir;
    }

    const contents = fs.readdirSync(dataDir).map((x) => path.join(dataDir, x));
    const directories = contents.filter((x) => fs.lstatSync(x).isDirectory());

    let sources = await readFilesOrURLsInDirectory(dataDir);

    for (const dir of directories) {
        let jsonSamples: Readable[] = [];
        const schemaSources: SchemaTypeSource[] = [];
        const graphQLSources: GraphQLTypeSource[] = [];

        for (const source of await readFilesOrURLsInDirectory(dir)) {
            switch (source.kind) {
                case "json":
                    jsonSamples = jsonSamples.concat(source.samples);
                    break;
                case "schema":
                    schemaSources.push(source);
                    break;
                case "graphql":
                    graphQLSources.push(source);
                    break;
                default:
                    return assertNever(source);
            }
        }

        if (
            jsonSamples.length > 0 &&
            schemaSources.length + graphQLSources.length > 0
        ) {
            return messageError("DriverCannotMixJSONWithOtherSamples", {
                dir: dir,
            });
        }

        // FIXME: rewrite this to be clearer
        const oneUnlessEmpty = (xs: TypeSource[]): 0 | 1 =>
            Math.sign(xs.length) as 0 | 1;
        if (
            oneUnlessEmpty(schemaSources) + oneUnlessEmpty(graphQLSources) >
            1
        ) {
            return messageError("DriverCannotMixNonJSONInputs", { dir: dir });
        }

        if (jsonSamples.length > 0) {
            sources.push({
                kind: "json",
                name: path.basename(dir),
                samples: jsonSamples,
            });
        }

        sources = sources.concat(schemaSources);
        sources = sources.concat(graphQLSources);
    }

    return sources;
}

// Returns an array of [name, sourceURIs] pairs.
async function getSourceURIs(
    options: CLIOptions,
): Promise<Array<[string, string[]]>> {
    if (options.srcUrls !== undefined) {
        const json = parseJSON(
            await readFromFileOrURL(options.srcUrls, options.httpHeader),
            "URL grammar",
            options.srcUrls,
        );
        const jsonMap = urlsFromURLGrammar(json);
        const topLevels = Object.getOwnPropertyNames(jsonMap);
        return topLevels.map(
            (name) => [name, jsonMap[name]] as [string, string[]],
        );
    }
    if (options.src.length === 0) {
        return [[options.topLevel, ["-"]]];
    }

    return [];
}

async function typeSourcesForURIs(
    name: string,
    uris: string[],
    options: CLIOptions,
): Promise<TypeSource[]> {
    switch (options.srcLang) {
        case "json":
            return [
                await sourceFromFileOrUrlArray(name, uris, options.httpHeader),
            ];
        case "schema":
            return uris.map(
                (uri) =>
                    ({
                        kind: "schema",
                        name,
                        uris: [uri],
                    }) as SchemaTypeSource,
            );
        default:
            return panic(
                `typeSourceForURIs must not be called for source language ${options.srcLang}`,
            );
    }
}

export async function getSources(options: CLIOptions): Promise<TypeSource[]> {
    const sourceURIs = await getSourceURIs(options);
    const sourceArrays = await Promise.all(
        sourceURIs.map(
            async ([name, uris]) =>
                await typeSourcesForURIs(name, uris, options),
        ),
    );
    let sources: TypeSource[] = ([] as TypeSource[]).concat(...sourceArrays);

    const exists = options.src.filter(fs.existsSync);
    const directories = exists.filter((x) => fs.lstatSync(x).isDirectory());

    for (const dataDir of directories) {
        sources = sources.concat(
            await samplesFromDirectory(dataDir, options.httpHeader),
        );
    }

    // Every src that's not a directory is assumed to be a file or URL
    const filesOrUrls = options.src.filter((x) => !_.includes(directories, x));
    if (!_.isEmpty(filesOrUrls)) {
        sources.push(
            ...(await typeSourcesForURIs(
                options.topLevel,
                filesOrUrls,
                options,
            )),
        );
    }

    return sources;
}

export function makeTypeScriptSource(fileNames: string[]): SchemaTypeSource {
    return Object.assign(
        { kind: "schema" },
        schemaForTypeScriptSources(fileNames),
    ) as SchemaTypeSource;
}
