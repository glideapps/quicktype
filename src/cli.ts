import { Map } from "immutable";

import * as fs from "fs";
import * as path from "path";
import * as _ from "lodash";

import {
    Options,
    JSONTypeSource,
    RendererOptions,
    getTargetLanguage,
    TypeSource,
    GraphQLTypeSource,
    isJSONSource,
    StringInput,
    SchemaTypeSource,
    isSchemaSource,
    quicktypeMultiFile,
    SerializedRenderResult,
    TargetLanguage
} from ".";
import { OptionDefinition } from "./RendererOptions";
import * as targetLanguages from "./Language/All";
import { urlsFromURLGrammar } from "./URLGrammar";
import { Annotation } from "./Source";
import { IssueAnnotationData } from "./Annotation";
import { Readable } from "stream";
import { panic, assert, defined, withDefault } from "./Support";
import { introspectServer } from "./GraphQLIntrospection";
import { getStream } from "./get-stream/index";
import { train } from "./MarkovChain";
import { sourcesFromPostmanCollection } from "./PostmanCollection";
import { readableFromFileOrURL, readFromFileOrURL, FetchingJSONSchemaStore } from "./NodeIO";

const commandLineArgs = require("command-line-args");
const getUsage = require("command-line-usage");
const chalk = require("chalk");
const wordWrap: (s: string) => string = require("wordwrap")(90);

const packageJSON = require("../package.json");

const langs = targetLanguages.all.map(r => _.minBy(r.names, s => s.length)).join("|");
const langDisplayNames = targetLanguages.all.map(r => r.displayName).join(", ");

export interface CLIOptions {
    lang: string;
    topLevel: string;
    src: string[];
    srcUrls?: string;
    srcLang: string;
    graphqlSchema?: string;
    graphqlIntrospect?: string;
    graphqlServerHeader?: string[];
    addSchemaTopLevel?: string;
    template?: string;
    out?: string;
    buildMarkovChain?: string;
    findSimilarClassesSchema?: string;

    noMaps: boolean;
    noEnums: boolean;
    noDateTimes: boolean;
    alphabetizeProperties: boolean;
    allPropertiesOptional: boolean;
    noCombineClasses: boolean;
    noRender: boolean;

    rendererOptions: RendererOptions;

    help: boolean;
    quiet: boolean;
    version: boolean;
    debug?: string;
}

async function sourceFromFileOrUrlArray(name: string, filesOrUrls: string[]): Promise<JSONTypeSource> {
    const samples = await Promise.all(filesOrUrls.map(readableFromFileOrURL));
    return { name, samples };
}

function typeNameFromFilename(filename: string): string {
    const name = path.basename(filename);
    return name.substr(0, name.lastIndexOf("."));
}

async function samplesFromDirectory(dataDir: string, topLevelRefs: string[] | undefined): Promise<TypeSource[]> {
    async function readFilesOrURLsInDirectory(d: string): Promise<TypeSource[]> {
        const files = fs
            .readdirSync(d)
            .map(x => path.join(d, x))
            .filter(x => fs.lstatSync(x).isFile());
        // Each file is a (Name, JSON | URL)
        const sourcesInDir: TypeSource[] = [];
        const graphQLSources: GraphQLTypeSource[] = [];
        let graphQLSchema: Readable | undefined = undefined;
        for (let file of files) {
            const name = typeNameFromFilename(file);

            let fileOrUrl = file;
            file = file.toLowerCase();

            // If file is a URL string, download it
            if (file.endsWith(".url")) {
                fileOrUrl = fs.readFileSync(file, "utf8").trim();
            }

            if (file.endsWith(".url") || file.endsWith(".json")) {
                // FIXME: Why do we include the URI here?
                sourcesInDir.push({
                    name,
                    uri: fileOrUrl,
                    samples: [await readableFromFileOrURL(fileOrUrl)]
                });
            } else if (file.endsWith(".schema")) {
                sourcesInDir.push({
                    name,
                    uri: fileOrUrl,
                    topLevelRefs
                });
            } else if (file.endsWith(".gqlschema")) {
                assert(graphQLSchema === undefined, `More than one GraphQL schema in ${dataDir}`);
                graphQLSchema = await readableFromFileOrURL(fileOrUrl);
            } else if (file.endsWith(".graphql")) {
                graphQLSources.push({ name, schema: undefined, query: await readableFromFileOrURL(fileOrUrl) });
            }
        }

        if (graphQLSources.length > 0) {
            if (graphQLSchema === undefined) {
                return panic(`No GraphQL schema in ${dataDir}`);
            }
            const schema = JSON.parse(await getStream(graphQLSchema));
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
        let jsonSamples: StringInput[] = [];
        const schemaSources: SchemaTypeSource[] = [];
        const graphQLSources: GraphQLTypeSource[] = [];
        for (const source of await readFilesOrURLsInDirectory(dir)) {
            // FIXME: We do a type switch here, but we know which types we're putting in
            // in the function above.  It should separate it right away.
            if (isJSONSource(source)) {
                jsonSamples = jsonSamples.concat(source.samples);
            } else if (isSchemaSource(source)) {
                schemaSources.push(source);
            } else {
                graphQLSources.push(source);
            }
        }
        if (jsonSamples.length > 0 && schemaSources.length + graphQLSources.length > 0) {
            return panic("Cannot mix JSON samples with JSON Schema or GraphQL in input subdirectory");
        }
        if (schemaSources.length > 0 && graphQLSources.length > 0) {
            return panic("Cannot mix JSON Schema with GraphQL in an input subdirectory");
        }
        if (jsonSamples.length > 0) {
            sources.push({
                name: path.basename(dir),
                samples: jsonSamples
            });
        }
        sources = sources.concat(schemaSources);
        sources = sources.concat(graphQLSources);
    }

    return sources;
}

function inferLang(options: Partial<CLIOptions>): string {
    // Output file extension determines the language if language is undefined
    if (options.out !== undefined) {
        let extension = path.extname(options.out);
        if (extension === "") {
            throw new Error("Please specify a language (--lang) or an output file extension.");
        }
        return extension.substr(1);
    }

    return "go";
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

export function inferCLIOptions(opts: Partial<CLIOptions>): CLIOptions {
    let srcLang = opts.srcLang;
    if (opts.graphqlSchema !== undefined || opts.graphqlIntrospect !== undefined) {
        assert(
            srcLang === undefined || srcLang === "graphql",
            "If a GraphQL schema is specified, the source language must be GraphQL"
        );
        srcLang = "graphql";
    } else {
        assert(srcLang !== "graphql", "Please specify a GraphQL schema with --graphql-schema or --graphql-introspect");
        srcLang = withDefault<string>(srcLang, "json");
    }

    /* tslint:disable:strict-boolean-expressions */
    return {
        src: opts.src || [],
        srcLang: srcLang,
        lang: opts.lang || inferLang(opts),
        topLevel: opts.topLevel || inferTopLevel(opts),
        noMaps: !!opts.noMaps,
        noEnums: !!opts.noEnums,
        noDateTimes: !!opts.noDateTimes,
        noCombineClasses: !!opts.noCombineClasses,
        noRender: !!opts.noRender,
        alphabetizeProperties: !!opts.alphabetizeProperties,
        allPropertiesOptional: !!opts.allPropertiesOptional,
        rendererOptions: opts.rendererOptions || {},
        help: opts.help || false,
        quiet: opts.quiet || false,
        version: opts.version || false,
        out: opts.out,
        buildMarkovChain: opts.buildMarkovChain,
        findSimilarClassesSchema: opts.findSimilarClassesSchema,
        graphqlSchema: opts.graphqlSchema,
        graphqlIntrospect: opts.graphqlIntrospect,
        graphqlServerHeader: opts.graphqlServerHeader,
        addSchemaTopLevel: opts.addSchemaTopLevel,
        template: opts.template,
        debug: opts.debug
    };
    /* tslint:enable */
}

const optionDefinitions: OptionDefinition[] = [
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
    },
    {
        name: "lang",
        alias: "l",
        type: String,
        typeLabel: langs,
        description: "The target language."
    },
    {
        name: "src-lang",
        alias: "s",
        type: String,
        defaultValue: undefined,
        typeLabel: "json|schema|graphql|postman-json",
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
    },
    {
        name: "no-combine-classes",
        type: Boolean,
        description: "Don't combine similar classes."
    },
    {
        name: "add-schema-top-level",
        type: String,
        typeLabel: "REF",
        description: "Use JSON Schema definitions as top-levels.  Must be `/definitions/`."
    },
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
        name: "graphql-server-header",
        type: String,
        multiple: true,
        description: "HTTP header for the GraphQL introspection query."
    },
    {
        name: "template",
        type: String,
        typeLabel: "FILE",
        description: "Handlebars template file."
    },
    {
        name: "no-maps",
        type: Boolean,
        description: "Don't infer maps, always use classes."
    },
    {
        name: "no-enums",
        type: Boolean,
        description: "Don't infer enums, always use strings."
    },
    {
        name: "no-date-times",
        type: Boolean,
        description: "Don't infer dates or times."
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
        name: "find-similar-classes-schema",
        type: String,
        typeLabel: "FILE",
        description: "Base schema for finding similar classes"
    },
    {
        name: "quiet",
        type: Boolean,
        description: "Don't show issues in the generated code."
    },
    {
        name: "debug",
        type: String,
        typeLabel: "OPTIONS",
        description: "Comma separated debug options: print-graph"
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

interface UsageSection {
    header?: string;
    content?: string | string[];
    optionList?: OptionDefinition[];
    hide?: string[];
}

const sectionsBeforeRenderers: UsageSection[] = [
    {
        header: "Synopsis",
        content: `$ quicktype [[bold]{--lang} ${langs}] FILE|URL ...`
    },
    {
        header: "Description",
        content: `Given JSON sample data, quicktype outputs code for working with that data in ${langDisplayNames}.`
    },
    {
        header: "Options",
        optionList: optionDefinitions,
        hide: ["no-render", "build-markov-chain", "find-similar-classes-schema"]
    }
];

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
        content: "Learn more at [bold]{quicktype.io}"
    }
];

export function parseCLIOptions(argv: string[], targetLanguage?: TargetLanguage): CLIOptions {
    if (argv.length === 0) {
        return inferCLIOptions({ help: true });
    }

    // We can only fully parse the options once we know which renderer is selected,
    // because there are renderer-specific options.  But we only know which renderer
    // is selected after we've parsed the options.  Hence, we parse the options
    // twice.  This is the first parse to get the renderer:
    const incompleteOptions = parseOptions(optionDefinitions, argv, true);
    if (targetLanguage === undefined) {
        targetLanguage = getTargetLanguage(incompleteOptions.lang);
    }
    const rendererOptionDefinitions = targetLanguage.cliOptionDefinitions;
    // Use the global options as well as the renderer options from now on:
    const allOptionDefinitions = _.concat(optionDefinitions, rendererOptionDefinitions);
    try {
        // This is the parse that counts:
        return parseOptions(allOptionDefinitions, argv, false);
    } catch (error) {
        if (error.name === "UNKNOWN_OPTION") {
            usage();
            throw new Error("Unknown option");
        }
        throw error;
    }
}

// Parse the options in argv and split them into global options and renderer options,
// according to each option definition's `renderer` field.  If `partial` is false this
// will throw if it encounters an unknown option.
function parseOptions(definitions: OptionDefinition[], argv: string[], partial: boolean): CLIOptions {
    const opts: { [key: string]: any } = commandLineArgs(definitions, { argv, partial });
    const options: { rendererOptions: RendererOptions;[key: string]: any } = { rendererOptions: {} };
    definitions.forEach(o => {
        if (!(o.name in opts)) return;
        const v = opts[o.name];
        if (o.renderer !== undefined) options.rendererOptions[o.name] = v;
        else {
            const k = _.lowerFirst(
                o.name
                    .split("-")
                    .map(_.upperFirst)
                    .join("")
            );
            options[k] = v;
        }
    });
    return inferCLIOptions(options);
}

function usage() {
    const rendererSections: UsageSection[] = [];

    _.forEach(targetLanguages.all, language => {
        const definitions = language.cliOptionDefinitions;
        if (definitions.length === 0) return;

        rendererSections.push({
            header: `Options for ${language.displayName}`,
            optionList: definitions
        });
    });

    const sections = _.concat(sectionsBeforeRenderers, rendererSections, sectionsAfterRenderers);

    console.log(getUsage(sections));
}

// Returns an array of [name, sourceURIs] pairs.
async function getSourceURIs(options: CLIOptions): Promise<[string, string[]][]> {
    if (options.srcUrls !== undefined) {
        const json = JSON.parse(await readFromFileOrURL(options.srcUrls));
        const jsonMap = urlsFromURLGrammar(json);
        const topLevels = Object.getOwnPropertyNames(jsonMap);
        return topLevels.map(name => [name, jsonMap[name]] as [string, string[]]);
    } else if (options.src.length === 0) {
        return [[options.topLevel, ["-"]]];
    } else {
        return [];
    }
}

function topLevelRefsForOptions(options: CLIOptions): string[] | undefined {
    return options.addSchemaTopLevel === undefined ? undefined : [options.addSchemaTopLevel];
}

async function typeSourceForURIs(name: string, uris: string[], options: CLIOptions): Promise<TypeSource> {
    switch (options.srcLang) {
        case "json":
            return await sourceFromFileOrUrlArray(name, uris);
        case "schema":
            assert(uris.length === 1, `Must have exactly one schema for ${name}`);
            return {name, uri: uris[0], topLevelRefs: topLevelRefsForOptions(options) };
        default:
            return panic(`typeSourceForURIs must not be called for source language ${options.srcLang}`);
    }
}

async function getSources(options: CLIOptions): Promise<TypeSource[]> {
    const sourceURIs = await getSourceURIs(options);
    let sources: TypeSource[] = await Promise.all(sourceURIs.map(([name, uris]) => typeSourceForURIs(name, uris, options)));

    const exists = options.src.filter(fs.existsSync);
    const directories = exists.filter(x => fs.lstatSync(x).isDirectory());

    for (const dataDir of directories) {
        sources = sources.concat(await samplesFromDirectory(dataDir, topLevelRefsForOptions(options)));
    }

    // Every src that's not a directory is assumed to be a file or URL
    const filesOrUrls = options.src.filter(x => !_.includes(directories, x));
    if (!_.isEmpty(filesOrUrls)) {
        sources.push(await typeSourceForURIs(options.topLevel, filesOrUrls, options));
    }

    return sources;
}

export async function makeQuicktypeOptions(options: CLIOptions): Promise<Partial<Options> | undefined> {
    if (options.help) {
        usage();
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
        const mc = train(lines, 3);
        console.log(JSON.stringify(mc));
        return undefined;
    }

    let sources: TypeSource[] = [];
    let leadingComments: string[] | undefined = undefined;
    let fixedTopLevels: boolean = false;
    switch (options.srcLang) {
        case "graphql":
            let schemaString: string | undefined = undefined;
            let wroteSchemaToFile = false;
            if (options.graphqlIntrospect !== undefined) {
                schemaString = await introspectServer(
                    options.graphqlIntrospect,
                    withDefault<string[]>(options.graphqlServerHeader, [])
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
                    return panic("Please specify at least one GraphQL query as input");
                }
            }
            const gqlSources: GraphQLTypeSource[] = [];
            for (const queryFile of options.src) {
                if (schemaString === undefined) {
                    const schemaFile = defined(options.graphqlSchema);
                    schemaString = fs.readFileSync(schemaFile, "utf8");
                }
                const schema = JSON.parse(schemaString);
                const query = await readableFromFileOrURL(queryFile);
                const name = numSources === 1 ? options.topLevel : typeNameFromFilename(queryFile);
                gqlSources.push({ name, schema, query });
            }
            sources = gqlSources;
            break;
        case "json":
        case "schema":
            sources = await getSources(options);
            break;
        case "postman-json":
            for (const collectionFile of options.src) {
                const collectionJSON = fs.readFileSync(collectionFile, "utf8");
                const { sources: postmanSources, description } = sourcesFromPostmanCollection(collectionJSON);
                for (const src of postmanSources) {
                    sources.push(src);
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
            panic(`Unsupported source language (${options.srcLang})`);
            break;
    }

    let handlebarsTemplate: string | undefined = undefined;
    if (options.template !== undefined) {
        handlebarsTemplate = fs.readFileSync(options.template, "utf8");
    }

    let debugPrintGraph = false;
    if (options.debug !== undefined) {
        assert(options.debug === "print-graph", "The --debug option must be \"print-graph\"");
        debugPrintGraph = true;
    }

    return {
        lang: options.lang,
        sources,
        inferMaps: !options.noMaps,
        inferEnums: !options.noEnums,
        inferDates: !options.noDateTimes,
        alphabetizeProperties: options.alphabetizeProperties,
        allPropertiesOptional: options.allPropertiesOptional,
        combineClasses: !options.noCombineClasses,
        fixedTopLevels,
        noRender: options.noRender,
        rendererOptions: options.rendererOptions,
        leadingComments,
        handlebarsTemplate,
        findSimilarClassesSchemaURI: options.findSimilarClassesSchema,
        outputFilename: options.out !== undefined ? path.basename(options.out) : undefined,
        schemaStore: new FetchingJSONSchemaStore(),
        debugPrintGraph
    };
}

export function writeOutput(cliOptions: CLIOptions, resultsByFilename: Map<string, SerializedRenderResult>): void {
    let onFirst = true;
    resultsByFilename.forEach(({ lines, annotations }, filename) => {
        const output = lines.join("\n");

        if (cliOptions.out !== undefined) {
            fs.writeFileSync(path.join(path.dirname(cliOptions.out), filename), output);
        } else {
            if (!onFirst) {
                process.stdout.write("\n");
            }
            process.stdout.write(output);
        }
        if (cliOptions.quiet) {
            return;
        }
        annotations.forEach((sa: Annotation) => {
            const annotation = sa.annotation;
            if (!(annotation instanceof IssueAnnotationData)) return;
            const lineNumber = sa.span.start.line;
            const humanLineNumber = lineNumber + 1;
            console.error(`\nIssue in line ${humanLineNumber}: ${annotation.message}`);
            console.error(`${humanLineNumber}: ${lines[lineNumber]}`);
        });

        onFirst = false;
    });
}

export async function main(args: string[] | Partial<CLIOptions>) {
    let cliOptions: CLIOptions;
    if (Array.isArray(args)) {
        cliOptions = parseCLIOptions(args);
    } else {
        cliOptions = inferCLIOptions(args);
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
