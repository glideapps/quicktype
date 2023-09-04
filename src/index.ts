#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import * as _ from "lodash";
import { Readable } from "readable-stream";
import { hasOwnProperty, definedMap, withDefault, mapFromObject, mapMap } from "collection-utils";
import { exceptionToString } from "@glideapps/ts-necessities";

import {
    Options,
    RendererOptions,
    getTargetLanguage,
    quicktypeMultiFile,
    SerializedRenderResult,
    TargetLanguage,
    languageNamed,
    InputData,
    JSONSchemaInput,
    OptionDefinition,
    defaultTargetLanguages,
    IssueAnnotationData,
    panic,
    assert,
    defined,
    assertNever,
    parseJSON,
    trainMarkovChain,
    messageError,
    messageAssert,
    sourcesFromPostmanCollection,
    inferenceFlags,
    inferenceFlagNames,
    splitIntoWords,
    capitalize,
    JSONSourceData,
    JSONInput,
    getStream,
    readableFromFileOrURL,
    readFromFileOrURL,
    FetchingJSONSchemaStore
} from "quicktype-core";
import { schemaForTypeScriptSources } from "quicktype-typescript-input";
import { GraphQLInput } from "quicktype-graphql-input";

import { urlsFromURLGrammar } from "./URLGrammar";
import { introspectServer } from "./GraphQLIntrospection";
import { JSONTypeSource, TypeSource, GraphQLTypeSource, SchemaTypeSource } from "./TypeSource";
import { CompressedJSONFromStream } from "./CompressedJSONFromStream";

const stringToStream = require("string-to-stream");

import commandLineArgs from "command-line-args";
import getUsage from "command-line-usage";
import chalk from "chalk";
const wordWrap: (s: string) => string = require("wordwrap")(90);

const packageJSON = require("../package.json");

export interface CLIOptions {
    lang: string;
    topLevel: string;
    src: string[];
    srcUrls?: string;
    srcLang: string;
    additionalSchema: string[];
    graphqlSchema?: string;
    graphqlIntrospect?: string;
    httpHeader?: string[];
    httpMethod?: string;
    out?: string;
    buildMarkovChain?: string;

    alphabetizeProperties: boolean;
    allPropertiesOptional: boolean;
    noRender: boolean;

    rendererOptions: RendererOptions;

    help: boolean;
    quiet: boolean;
    version: boolean;
    debug?: string;
    telemetry?: string;

    // We use this to access the inference flags
    [option: string]: any;
}

const defaultDefaultTargetLanguageName = "go";

async function sourceFromFileOrUrlArray(
    name: string,
    filesOrUrls: string[],
    httpHeaders?: string[]
): Promise<JSONTypeSource> {
    const samples = await Promise.all(filesOrUrls.map(file => readableFromFileOrURL(file, httpHeaders)));
    return { kind: "json", name, samples };
}

function typeNameFromFilename(filename: string): string {
    const name = path.basename(filename);
    return name.substring(0, name.lastIndexOf("."));
}

async function samplesFromDirectory(dataDir: string, httpHeaders?: string[]): Promise<TypeSource[]> {
    async function readFilesOrURLsInDirectory(d: string): Promise<TypeSource[]> {
        const files = fs
            .readdirSync(d)
            .map(x => path.join(d, x))
            .filter(x => fs.lstatSync(x).isFile());
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
                    samples: [await readableFromFileOrURL(fileOrUrl, httpHeaders)]
                });
            } else if (file.endsWith(".schema")) {
                sourcesInDir.push({
                    kind: "schema",
                    name,
                    uris: [fileOrUrl]
                });
            } else if (file.endsWith(".gqlschema")) {
                messageAssert(graphQLSchema === undefined, "DriverMoreThanOneGraphQLSchemaInDir", {
                    dir: dataDir
                });
                graphQLSchema = await readableFromFileOrURL(fileOrUrl, httpHeaders);
                graphQLSchemaFileName = fileOrUrl;
            } else if (file.endsWith(".graphql")) {
                graphQLSources.push({
                    kind: "graphql",
                    name,
                    schema: undefined,
                    query: await getStream(await readableFromFileOrURL(fileOrUrl, httpHeaders))
                });
            }
        }

        if (graphQLSources.length > 0) {
            if (graphQLSchema === undefined) {
                return messageError("DriverNoGraphQLSchemaInDir", { dir: dataDir });
            }
            const schema = parseJSON(await getStream(graphQLSchema), "GraphQL schema", graphQLSchemaFileName);
            for (const source of graphQLSources) {
                source.schema = schema;
                sourcesInDir.push(source);
            }
        }

        return sourcesInDir;
    }

    const contents = fs.readdirSync(dataDir).map(x => path.join(dataDir, x));
    const directories = contents.filter(x => fs.lstatSync(x).isDirectory());

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

        if (jsonSamples.length > 0 && schemaSources.length + graphQLSources.length > 0) {
            return messageError("DriverCannotMixJSONWithOtherSamples", { dir: dir });
        }

        const oneUnlessEmpty = (xs: any[]) => Math.sign(xs.length);
        if (oneUnlessEmpty(schemaSources) + oneUnlessEmpty(graphQLSources) > 1) {
            return messageError("DriverCannotMixNonJSONInputs", { dir: dir });
        }

        if (jsonSamples.length > 0) {
            sources.push({
                kind: "json",
                name: path.basename(dir),
                samples: jsonSamples
            });
        }
        sources = sources.concat(schemaSources);
        sources = sources.concat(graphQLSources);
    }

    return sources;
}

function inferLang(options: Partial<CLIOptions>, defaultLanguage: string): string {
    // Output file extension determines the language if language is undefined
    if (options.out !== undefined) {
        let extension = path.extname(options.out);
        if (extension === "") {
            return messageError("DriverNoLanguageOrExtension", {});
        }
        return extension.slice(1);
    }

    return defaultLanguage;
}

function inferTopLevel(options: Partial<CLIOptions>): string {
    // Output file name determines the top-level if undefined
    if (options.out !== undefined) {
        let extension = path.extname(options.out);
        let without = path.basename(options.out).replace(extension, "");
        return without;
    }

    // Source determines the top-level if undefined
    if (options.src !== undefined && options.src.length === 1) {
        let src = options.src[0];
        let extension = path.extname(src);
        let without = path.basename(src).replace(extension, "");
        return without;
    }

    return "TopLevel";
}

function inferCLIOptions(opts: Partial<CLIOptions>, targetLanguage: TargetLanguage | undefined): CLIOptions {
    let srcLang = opts.srcLang;
    if (opts.graphqlSchema !== undefined || opts.graphqlIntrospect !== undefined) {
        messageAssert(srcLang === undefined || srcLang === "graphql", "DriverSourceLangMustBeGraphQL", {});
        srcLang = "graphql";
    } else if (opts.src !== undefined && opts.src.length > 0 && opts.src.every(file => _.endsWith(file, ".ts"))) {
        srcLang = "typescript";
    } else {
        messageAssert(srcLang !== "graphql", "DriverGraphQLSchemaNeeded", {});
        srcLang = withDefault<string>(srcLang, "json");
    }

    let language: TargetLanguage;
    if (targetLanguage !== undefined) {
        language = targetLanguage;
    } else {
        const languageName = opts.lang !== undefined ? opts.lang : inferLang(opts, defaultDefaultTargetLanguageName);
        const maybeLanguage = languageNamed(languageName);
        if (maybeLanguage === undefined) {
            return messageError("DriverUnknownOutputLanguage", { lang: languageName });
        }
        language = maybeLanguage;
    }

    /* tslint:disable:strict-boolean-expressions */
    const options: CLIOptions = {
        src: opts.src || [],
        srcUrls: opts.srcUrls,
        srcLang: srcLang,
        lang: language.displayName,
        topLevel: opts.topLevel || inferTopLevel(opts),
        noRender: !!opts.noRender,
        alphabetizeProperties: !!opts.alphabetizeProperties,
        allPropertiesOptional: !!opts.allPropertiesOptional,
        rendererOptions: opts.rendererOptions || {},
        help: opts.help || false,
        quiet: opts.quiet || false,
        version: opts.version || false,
        out: opts.out,
        buildMarkovChain: opts.buildMarkovChain,
        additionalSchema: opts.additionalSchema || [],
        graphqlSchema: opts.graphqlSchema,
        graphqlIntrospect: opts.graphqlIntrospect,
        httpMethod: opts.httpMethod,
        httpHeader: opts.httpHeader,
        debug: opts.debug,
        telemetry: opts.telemetry
    };
    /* tslint:enable */
    for (const flagName of inferenceFlagNames) {
        const cliName = negatedInferenceFlagName(flagName);
        options[cliName] = !!opts[cliName];
    }
    return options;
}

function makeLangTypeLabel(targetLanguages: TargetLanguage[]): string {
    assert(targetLanguages.length > 0, "Must have at least one target language");
    return targetLanguages.map(r => _.minBy(r.names, s => s.length)).join("|");
}

function negatedInferenceFlagName(name: string): string {
    const prefix = "infer";
    if (name.startsWith(prefix)) {
        name = name.slice(prefix.length);
    }
    return "no" + capitalize(name);
}

function dashedFromCamelCase(name: string): string {
    return splitIntoWords(name)
        .map(w => w.word.toLowerCase())
        .join("-");
}

function makeOptionDefinitions(targetLanguages: TargetLanguage[]): OptionDefinition[] {
    const beforeLang: OptionDefinition[] = [
        {
            name: "out",
            alias: "o",
            type: String,
            typeLabel: `FILE`,
            description: "The output file. Determines --lang and --top-level."
        },
        {
            name: "top-level",
            alias: "t",
            type: String,
            typeLabel: "NAME",
            description: "The name for the top level type."
        }
    ];
    const lang: OptionDefinition[] =
        targetLanguages.length < 2
            ? []
            : [
                  {
                      name: "lang",
                      alias: "l",
                      type: String,
                      typeLabel: "LANG",
                      description: "The target language."
                  }
              ];
    const afterLang: OptionDefinition[] = [
        {
            name: "src-lang",
            alias: "s",
            type: String,
            defaultValue: undefined,
            typeLabel: "SRC_LANG",
            description: "The source language (default is json)."
        },
        {
            name: "src",
            type: String,
            multiple: true,
            defaultOption: true,
            typeLabel: "FILE|URL|DIRECTORY",
            description: "The file, url, or data directory to type."
        },
        {
            name: "src-urls",
            type: String,
            typeLabel: "FILE",
            description: "Tracery grammar describing URLs to crawl."
        }
    ];
    const inference: OptionDefinition[] = Array.from(
        mapMap(mapFromObject(inferenceFlags), (flag, name) => {
            return {
                name: dashedFromCamelCase(negatedInferenceFlagName(name)),
                type: Boolean,
                description: flag.negationDescription + "."
            };
        }).values()
    );
    const afterInference: OptionDefinition[] = [
        {
            name: "graphql-schema",
            type: String,
            typeLabel: "FILE",
            description: "GraphQL introspection file."
        },
        {
            name: "graphql-introspect",
            type: String,
            typeLabel: "URL",
            description: "Introspect GraphQL schema from a server."
        },
        {
            name: "http-method",
            type: String,
            typeLabel: "METHOD",
            description: "HTTP method to use for the GraphQL introspection query."
        },
        {
            name: "http-header",
            type: String,
            multiple: true,
            typeLabel: "HEADER",
            description: "Header(s) to attach to all HTTP requests, including the GraphQL introspection query."
        },
        {
            name: "additional-schema",
            alias: "S",
            type: String,
            multiple: true,
            typeLabel: "FILE",
            description: "Register the $id's of additional JSON Schema files."
        },
        {
            name: "no-render",
            type: Boolean,
            description: "Don't render output."
        },
        {
            name: "alphabetize-properties",
            type: Boolean,
            description: "Alphabetize order of class properties."
        },
        {
            name: "all-properties-optional",
            type: Boolean,
            description: "Make all class properties optional."
        },
        {
            name: "build-markov-chain",
            type: String,
            typeLabel: "FILE",
            description: "Markov chain corpus filename."
        },
        {
            name: "quiet",
            type: Boolean,
            description: "Don't show issues in the generated code."
        },
        {
            name: "debug",
            type: String,
            typeLabel: "OPTIONS or all",
            description:
                "Comma separated debug options: print-graph, print-reconstitution, print-gather-names, print-transformations, print-schema-resolving, print-times, provenance"
        },
        {
            name: "telemetry",
            type: String,
            typeLabel: "enable|disable",
            description: "Enable anonymous telemetry to help improve quicktype"
        },
        {
            name: "help",
            alias: "h",
            type: Boolean,
            description: "Get some help."
        },
        {
            name: "version",
            alias: "v",
            type: Boolean,
            description: "Display the version of quicktype"
        }
    ];
    return beforeLang.concat(lang, afterLang, inference, afterInference);
}

interface ColumnDefinition {
    name: string;
    width?: number;
    padding?: { left: string; right: string };
}

interface TableOptions {
    columns: ColumnDefinition[];
}

interface UsageSection {
    header?: string;
    content?: string | string[];
    optionList?: OptionDefinition[];
    tableOptions?: TableOptions;
    hide?: string[];
}

const tableOptionsForOptions: TableOptions = {
    columns: [
        {
            name: "option",
            width: 60
        },
        {
            name: "description",
            width: 60
        }
    ]
};

function makeSectionsBeforeRenderers(targetLanguages: TargetLanguage[]): UsageSection[] {
    const langDisplayNames = targetLanguages.map(r => r.displayName).join(", ");

    return [
        {
            header: "Synopsis",
            content: [
                `$ quicktype [${chalk.bold("--lang")} LANG] [${chalk.bold("--src-lang")} SRC_LANG] [${chalk.bold(
                    "--out"
                )} FILE] FILE|URL ...`,
                "",
                `  LANG ... ${makeLangTypeLabel(targetLanguages)}`,
                "",
                "SRC_LANG ... json|schema|graphql|postman|typescript"
            ]
        },
        {
            header: "Description",
            content: `Given JSON sample data, quicktype outputs code for working with that data in ${langDisplayNames}.`
        },
        {
            header: "Options",
            optionList: makeOptionDefinitions(targetLanguages),
            hide: ["no-render", "build-markov-chain"],
            tableOptions: tableOptionsForOptions
        }
    ];
}

const sectionsAfterRenderers: UsageSection[] = [
    {
        header: "Examples",
        content: [
            chalk.dim("Generate C# to parse a Bitcoin API"),
            "$ quicktype -o LatestBlock.cs https://blockchain.info/latestblock",
            "",
            chalk.dim("Generate Go code from a directory of samples containing:"),
            chalk.dim(
                `  - Foo.json
  + Bar
    - bar-sample-1.json
    - bar-sample-2.json
  - Baz.url`
            ),
            "$ quicktype -l go samples",
            "",
            chalk.dim("Generate JSON Schema, then TypeScript"),
            "$ quicktype -o schema.json https://blockchain.info/latestblock",
            "$ quicktype -o bitcoin.ts --src-lang schema schema.json"
        ]
    },
    {
        content: `Learn more at ${chalk.bold("quicktype.io")}`
    }
];

export function parseCLIOptions(argv: string[], targetLanguage?: TargetLanguage): CLIOptions {
    if (argv.length === 0) {
        return inferCLIOptions({ help: true }, targetLanguage);
    }

    const targetLanguages = targetLanguage === undefined ? defaultTargetLanguages : [targetLanguage];
    const optionDefinitions = makeOptionDefinitions(targetLanguages);

    // We can only fully parse the options once we know which renderer is selected,
    // because there are renderer-specific options.  But we only know which renderer
    // is selected after we've parsed the options.  Hence, we parse the options
    // twice.  This is the first parse to get the renderer:
    const incompleteOptions = inferCLIOptions(parseOptions(optionDefinitions, argv, true), targetLanguage);
    if (targetLanguage === undefined) {
        targetLanguage = getTargetLanguage(incompleteOptions.lang);
    }
    const rendererOptionDefinitions = targetLanguage.cliOptionDefinitions.actual;
    // Use the global options as well as the renderer options from now on:
    const allOptionDefinitions = _.concat(optionDefinitions, rendererOptionDefinitions);
    // This is the parse that counts:
    return inferCLIOptions(parseOptions(allOptionDefinitions, argv, false), targetLanguage);
}

// Parse the options in argv and split them into global options and renderer options,
// according to each option definition's `renderer` field.  If `partial` is false this
// will throw if it encounters an unknown option.
function parseOptions(definitions: OptionDefinition[], argv: string[], partial: boolean): Partial<CLIOptions> {
    let opts: { [key: string]: any };
    try {
        opts = commandLineArgs(definitions, { argv, partial });
    } catch (e) {
        assert(!partial, "Partial option parsing should not have failed");
        return messageError("DriverCLIOptionParsingFailed", { message: exceptionToString(e) });
    }
    for (const k of Object.keys(opts)) {
        if (opts[k] === null) {
            return messageError("DriverCLIOptionParsingFailed", {
                message: `Missing value for command line option "${k}"`
            });
        }
    }

    const options: { rendererOptions: RendererOptions; [key: string]: any } = { rendererOptions: {} };
    for (const o of definitions) {
        if (!hasOwnProperty(opts, o.name)) continue;
        const v = opts[o.name] as string;
        if (o.renderer !== undefined) options.rendererOptions[o.name] = v;
        else {
            const k = _.lowerFirst(o.name.split("-").map(_.upperFirst).join(""));
            options[k] = v;
        }
    }
    return options;
}

function usage(targetLanguages: TargetLanguage[]) {
    const rendererSections: UsageSection[] = [];

    for (const language of targetLanguages) {
        const definitions = language.cliOptionDefinitions.display;
        if (definitions.length === 0) continue;

        rendererSections.push({
            header: `Options for ${language.displayName}`,
            optionList: definitions,
            tableOptions: tableOptionsForOptions
        });
    }

    const sections = _.concat(makeSectionsBeforeRenderers(targetLanguages), rendererSections, sectionsAfterRenderers);

    console.log(getUsage(sections));
}

// Returns an array of [name, sourceURIs] pairs.
async function getSourceURIs(options: CLIOptions): Promise<[string, string[]][]> {
    if (options.srcUrls !== undefined) {
        const json = parseJSON(
            await readFromFileOrURL(options.srcUrls, options.httpHeader),
            "URL grammar",
            options.srcUrls
        );
        const jsonMap = urlsFromURLGrammar(json);
        const topLevels = Object.getOwnPropertyNames(jsonMap);
        return topLevels.map(name => [name, jsonMap[name]] as [string, string[]]);
    } else if (options.src.length === 0) {
        return [[options.topLevel, ["-"]]];
    } else {
        return [];
    }
}

async function typeSourcesForURIs(name: string, uris: string[], options: CLIOptions): Promise<TypeSource[]> {
    switch (options.srcLang) {
        case "json":
            return [await sourceFromFileOrUrlArray(name, uris, options.httpHeader)];
        case "schema":
            return uris.map(uri => ({ kind: "schema", name, uris: [uri] }) as SchemaTypeSource);
        default:
            return panic(`typeSourceForURIs must not be called for source language ${options.srcLang}`);
    }
}

async function getSources(options: CLIOptions): Promise<TypeSource[]> {
    const sourceURIs = await getSourceURIs(options);
    const sourceArrays = await Promise.all(
        sourceURIs.map(async ([name, uris]) => await typeSourcesForURIs(name, uris, options))
    );
    let sources: TypeSource[] = ([] as TypeSource[]).concat(...sourceArrays);

    const exists = options.src.filter(fs.existsSync);
    const directories = exists.filter(x => fs.lstatSync(x).isDirectory());

    for (const dataDir of directories) {
        sources = sources.concat(await samplesFromDirectory(dataDir, options.httpHeader));
    }

    // Every src that's not a directory is assumed to be a file or URL
    const filesOrUrls = options.src.filter(x => !_.includes(directories, x));
    if (!_.isEmpty(filesOrUrls)) {
        sources.push(...(await typeSourcesForURIs(options.topLevel, filesOrUrls, options)));
    }

    return sources;
}

function makeTypeScriptSource(fileNames: string[]): SchemaTypeSource {
    return Object.assign({ kind: "schema" }, schemaForTypeScriptSources(fileNames)) as SchemaTypeSource;
}

export function jsonInputForTargetLanguage(
    targetLanguage: string | TargetLanguage,
    languages?: TargetLanguage[],
    handleJSONRefs = false
): JSONInput<Readable> {
    if (typeof targetLanguage === "string") {
        targetLanguage = defined(languageNamed(targetLanguage, languages));
    }
    const compressedJSON = new CompressedJSONFromStream(targetLanguage.dateTimeRecognizer, handleJSONRefs);
    return new JSONInput(compressedJSON);
}

async function makeInputData(
    sources: TypeSource[],
    targetLanguage: TargetLanguage,
    additionalSchemaAddresses: ReadonlyArray<string>,
    handleJSONRefs: boolean,
    httpHeaders?: string[]
): Promise<InputData> {
    const inputData = new InputData();

    for (const source of sources) {
        switch (source.kind) {
            case "graphql":
                await inputData.addSource("graphql", source, () => new GraphQLInput());
                break;
            case "json":
                await inputData.addSource("json", source, () =>
                    jsonInputForTargetLanguage(targetLanguage, undefined, handleJSONRefs)
                );
                break;
            case "schema":
                await inputData.addSource(
                    "schema",
                    source,
                    () => new JSONSchemaInput(new FetchingJSONSchemaStore(httpHeaders), [], additionalSchemaAddresses)
                );
                break;
            default:
                return assertNever(source);
        }
    }

    return inputData;
}

function stringSourceDataToStreamSourceData(src: JSONSourceData<string>): JSONSourceData<Readable> {
    return { name: src.name, description: src.description, samples: src.samples.map(stringToStream) };
}

export async function makeQuicktypeOptions(
    options: CLIOptions,
    targetLanguages?: TargetLanguage[]
): Promise<Partial<Options> | undefined> {
    if (options.help) {
        usage(targetLanguages === undefined ? defaultTargetLanguages : targetLanguages);
        return undefined;
    }
    if (options.version) {
        console.log(`quicktype version ${packageJSON.version}`);
        console.log("Visit quicktype.io for more info.");
        return undefined;
    }
    if (options.buildMarkovChain !== undefined) {
        const contents = fs.readFileSync(options.buildMarkovChain).toString();
        const lines = contents.split("\n");
        const mc = trainMarkovChain(lines, 3);
        console.log(JSON.stringify(mc));
        return undefined;
    }

    let sources: TypeSource[] = [];
    let leadingComments: string[] | undefined = undefined;
    let fixedTopLevels = false;
    switch (options.srcLang) {
        case "graphql":
            let schemaString: string | undefined = undefined;
            let wroteSchemaToFile = false;
            if (options.graphqlIntrospect !== undefined) {
                schemaString = await introspectServer(
                    options.graphqlIntrospect,
                    withDefault(options.httpMethod, "POST"),
                    withDefault<string[]>(options.httpHeader, [])
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
                    return undefined;
                }
                if (numSources === 0) {
                    if (schemaString !== undefined) {
                        console.log(schemaString);
                        return undefined;
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
                const schema = parseJSON(schemaString, "GraphQL schema", schemaFileName);
                const query = await getStream(await readableFromFileOrURL(queryFile, options.httpHeader));
                const name = numSources === 1 ? options.topLevel : typeNameFromFilename(queryFile);
                gqlSources.push({ kind: "graphql", name, schema, query });
            }
            sources = gqlSources;
            break;
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
                const { sources: postmanSources, description } = sourcesFromPostmanCollection(
                    collectionJSON,
                    collectionFile
                );
                for (const src of postmanSources) {
                    sources.push(
                        Object.assign({ kind: "json" }, stringSourceDataToStreamSourceData(src)) as JSONTypeSource
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
            return messageError("DriverUnknownSourceLanguage", { lang: options.srcLang });
    }

    const components = definedMap(options.debug, d => d.split(","));
    const debugAll = components !== undefined && components.indexOf("all") >= 0;
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
                return messageError("DriverUnknownDebugOption", { option: component });
            }
        }
    }

    const lang = languageNamed(options.lang, targetLanguages);
    if (lang === undefined) {
        return messageError("DriverUnknownOutputLanguage", { lang: options.lang });
    }

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
        debugPrintTimes
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
        options.httpHeader
    );

    return quicktypeOptions;
}

export function writeOutput(
    cliOptions: CLIOptions,
    resultsByFilename: ReadonlyMap<string, SerializedRenderResult>
): void {
    let onFirst = true;
    for (const [filename, { lines, annotations }] of resultsByFilename) {
        const output = lines.join("\n");

        if (cliOptions.out !== undefined) {
            fs.writeFileSync(path.join(path.dirname(cliOptions.out), filename), output);
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
            console.error(`\nIssue in line ${humanLineNumber}: ${annotation.message}`);
            console.error(`${humanLineNumber}: ${lines[lineNumber]}`);
        }

        onFirst = false;
    }
}

export async function main(args: string[] | Partial<CLIOptions>) {
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
                console.error(chalk.red("telemetry must be 'enable' or 'disable'"));
                return;
        }
        if (Array.isArray(args) && args.length === 2) {
            // This was merely a CLI run to set telemetry and we should not proceed
            return;
        }
    }

    const quicktypeOptions = await makeQuicktypeOptions(cliOptions);
    if (quicktypeOptions === undefined) return;

    const resultsByFilename = await quicktypeMultiFile(quicktypeOptions);

    writeOutput(cliOptions, resultsByFilename);
}

if (require.main === module) {
    main(process.argv.slice(2)).catch(e => {
        if (e instanceof Error) {
            console.error(`Error: ${e.message}.`);
        } else {
            console.error(e);
        }
        process.exit(1);
    });
}
