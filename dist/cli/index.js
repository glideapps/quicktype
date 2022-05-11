#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
const _ = require("lodash");
const collection_utils_1 = require("collection-utils");
const quicktype_core_1 = require("../quicktype-core");
const quicktype_typescript_input_1 = require("../quicktype-typescript-input");
const quicktype_graphql_input_1 = require("../quicktype-graphql-input");
const URLGrammar_1 = require("./URLGrammar");
const GraphQLIntrospection_1 = require("./GraphQLIntrospection");
const CompressedJSONFromStream_1 = require("./CompressedJSONFromStream");
const stringToStream = require("string-to-stream");
const commandLineArgs = require("command-line-args");
const getUsage = require("command-line-usage");
const chalk = require("chalk");
const wordWrap = require("wordwrap")(90);
const packageJSON = require("../../package.json");
const defaultDefaultTargetLanguageName = "go";
function sourceFromFileOrUrlArray(name, filesOrUrls, httpHeaders) {
    return __awaiter(this, void 0, void 0, function* () {
        const samples = yield Promise.all(filesOrUrls.map(file => quicktype_core_1.readableFromFileOrURL(file, httpHeaders)));
        return { kind: "json", name, samples };
    });
}
function typeNameFromFilename(filename) {
    const name = path.basename(filename);
    return name.substr(0, name.lastIndexOf("."));
}
function samplesFromDirectory(dataDir, httpHeaders) {
    return __awaiter(this, void 0, void 0, function* () {
        function readFilesOrURLsInDirectory(d) {
            return __awaiter(this, void 0, void 0, function* () {
                const files = fs
                    .readdirSync(d)
                    .map(x => path.join(d, x))
                    .filter(x => fs.lstatSync(x).isFile());
                // Each file is a (Name, JSON | URL)
                const sourcesInDir = [];
                const graphQLSources = [];
                let graphQLSchema = undefined;
                let graphQLSchemaFileName = undefined;
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
                            samples: [yield quicktype_core_1.readableFromFileOrURL(fileOrUrl, httpHeaders)]
                        });
                    }
                    else if (file.endsWith(".schema")) {
                        sourcesInDir.push({
                            kind: "schema",
                            name,
                            uris: [fileOrUrl]
                        });
                    }
                    else if (file.endsWith(".gqlschema")) {
                        quicktype_core_1.messageAssert(graphQLSchema === undefined, "DriverMoreThanOneGraphQLSchemaInDir", {
                            dir: dataDir
                        });
                        graphQLSchema = yield quicktype_core_1.readableFromFileOrURL(fileOrUrl, httpHeaders);
                        graphQLSchemaFileName = fileOrUrl;
                    }
                    else if (file.endsWith(".graphql")) {
                        graphQLSources.push({
                            kind: "graphql",
                            name,
                            schema: undefined,
                            query: yield quicktype_core_1.getStream(yield quicktype_core_1.readableFromFileOrURL(fileOrUrl, httpHeaders))
                        });
                    }
                }
                if (graphQLSources.length > 0) {
                    if (graphQLSchema === undefined) {
                        return quicktype_core_1.messageError("DriverNoGraphQLSchemaInDir", { dir: dataDir });
                    }
                    const schema = quicktype_core_1.parseJSON(yield quicktype_core_1.getStream(graphQLSchema), "GraphQL schema", graphQLSchemaFileName);
                    for (const source of graphQLSources) {
                        source.schema = schema;
                        sourcesInDir.push(source);
                    }
                }
                return sourcesInDir;
            });
        }
        const contents = fs.readdirSync(dataDir).map(x => path.join(dataDir, x));
        const directories = contents.filter(x => fs.lstatSync(x).isDirectory());
        let sources = yield readFilesOrURLsInDirectory(dataDir);
        for (const dir of directories) {
            let jsonSamples = [];
            const schemaSources = [];
            const graphQLSources = [];
            for (const source of yield readFilesOrURLsInDirectory(dir)) {
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
                        return quicktype_core_1.assertNever(source);
                }
            }
            if (jsonSamples.length > 0 && schemaSources.length + graphQLSources.length > 0) {
                return quicktype_core_1.messageError("DriverCannotMixJSONWithOtherSamples", { dir: dir });
            }
            const oneUnlessEmpty = (xs) => Math.sign(xs.length);
            if (oneUnlessEmpty(schemaSources) + oneUnlessEmpty(graphQLSources) > 1) {
                return quicktype_core_1.messageError("DriverCannotMixNonJSONInputs", { dir: dir });
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
    });
}
function inferLang(options, defaultLanguage) {
    // Output file extension determines the language if language is undefined
    if (options.out !== undefined) {
        let extension = path.extname(options.out);
        if (extension === "") {
            return quicktype_core_1.messageError("DriverNoLanguageOrExtension", {});
        }
        return extension.substr(1);
    }
    return defaultLanguage;
}
function inferTopLevel(options) {
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
function inferCLIOptions(opts, targetLanguage) {
    let srcLang = opts.srcLang;
    if (opts.graphqlSchema !== undefined || opts.graphqlIntrospect !== undefined) {
        quicktype_core_1.messageAssert(srcLang === undefined || srcLang === "graphql", "DriverSourceLangMustBeGraphQL", {});
        srcLang = "graphql";
    }
    else if (opts.src !== undefined && opts.src.length > 0 && opts.src.every(file => _.endsWith(file, ".ts"))) {
        srcLang = "typescript";
    }
    else {
        quicktype_core_1.messageAssert(srcLang !== "graphql", "DriverGraphQLSchemaNeeded", {});
        srcLang = collection_utils_1.withDefault(srcLang, "json");
    }
    let language;
    if (targetLanguage !== undefined) {
        language = targetLanguage;
    }
    else {
        const languageName = opts.lang !== undefined ? opts.lang : inferLang(opts, defaultDefaultTargetLanguageName);
        const maybeLanguage = quicktype_core_1.languageNamed(languageName);
        if (maybeLanguage === undefined) {
            return quicktype_core_1.messageError("DriverUnknownOutputLanguage", { lang: languageName });
        }
        language = maybeLanguage;
    }
    /* tslint:disable:strict-boolean-expressions */
    const options = {
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
    for (const flagName of quicktype_core_1.inferenceFlagNames) {
        const cliName = negatedInferenceFlagName(flagName);
        options[cliName] = !!opts[cliName];
    }
    return options;
}
function makeLangTypeLabel(targetLanguages) {
    quicktype_core_1.assert(targetLanguages.length > 0, "Must have at least one target language");
    return targetLanguages.map(r => _.minBy(r.names, s => s.length)).join("|");
}
function negatedInferenceFlagName(name) {
    const prefix = "infer";
    if (name.startsWith(prefix)) {
        name = name.substr(prefix.length);
    }
    return "no" + quicktype_core_1.capitalize(name);
}
function dashedFromCamelCase(name) {
    return quicktype_core_1.splitIntoWords(name)
        .map(w => w.word.toLowerCase())
        .join("-");
}
function makeOptionDefinitions(targetLanguages) {
    const beforeLang = [
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
    const lang = targetLanguages.length < 2
        ? []
        : [
            {
                name: "lang",
                alias: "l",
                type: String,
                typeLabel: makeLangTypeLabel(targetLanguages),
                description: "The target language."
            }
        ];
    const afterLang = [
        {
            name: "src-lang",
            alias: "s",
            type: String,
            defaultValue: undefined,
            typeLabel: "json|schema|graphql|postman|typescript",
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
    const inference = Array.from(collection_utils_1.mapMap(collection_utils_1.mapFromObject(quicktype_core_1.inferenceFlags), (flag, name) => {
        return {
            name: dashedFromCamelCase(negatedInferenceFlagName(name)),
            type: Boolean,
            description: flag.negationDescription + "."
        };
    }).values());
    const afterInference = [
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
            description: "Comma separated debug options: print-graph, print-reconstitution, print-gather-names, print-transformations, print-schema-resolving, print-times, provenance"
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
const tableOptionsForOptions = {
    columns: [
        {
            name: "option",
            width: 50
        },
        {
            name: "description"
        }
    ]
};
function makeSectionsBeforeRenderers(targetLanguages) {
    const langDisplayNames = targetLanguages.map(r => r.displayName).join(", ");
    return [
        {
            header: "Synopsis",
            content: [
                `$ quicktype [${chalk.bold("--lang")} LANG] [${chalk.bold("--out")} FILE] FILE|URL ...`,
                "",
                `  LANG ... ${makeLangTypeLabel(targetLanguages)}`
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
const sectionsAfterRenderers = [
    {
        header: "Examples",
        content: [
            chalk.dim("Generate C# to parse a Bitcoin API"),
            "$ quicktype -o LatestBlock.cs https://blockchain.info/latestblock",
            "",
            chalk.dim("Generate Go code from a directory of samples containing:"),
            chalk.dim(`  - Foo.json
  + Bar
    - bar-sample-1.json
    - bar-sample-2.json
  - Baz.url`),
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
function parseCLIOptions(argv, targetLanguage) {
    if (argv.length === 0) {
        return inferCLIOptions({ help: true }, targetLanguage);
    }
    const targetLanguages = targetLanguage === undefined ? quicktype_core_1.defaultTargetLanguages : [targetLanguage];
    const optionDefinitions = makeOptionDefinitions(targetLanguages);
    // We can only fully parse the options once we know which renderer is selected,
    // because there are renderer-specific options.  But we only know which renderer
    // is selected after we've parsed the options.  Hence, we parse the options
    // twice.  This is the first parse to get the renderer:
    const incompleteOptions = inferCLIOptions(parseOptions(optionDefinitions, argv, true), targetLanguage);
    if (targetLanguage === undefined) {
        targetLanguage = quicktype_core_1.getTargetLanguage(incompleteOptions.lang);
    }
    const rendererOptionDefinitions = targetLanguage.cliOptionDefinitions.actual;
    // Use the global options as well as the renderer options from now on:
    const allOptionDefinitions = _.concat(optionDefinitions, rendererOptionDefinitions);
    // This is the parse that counts:
    return inferCLIOptions(parseOptions(allOptionDefinitions, argv, false), targetLanguage);
}
exports.parseCLIOptions = parseCLIOptions;
// Parse the options in argv and split them into global options and renderer options,
// according to each option definition's `renderer` field.  If `partial` is false this
// will throw if it encounters an unknown option.
function parseOptions(definitions, argv, partial) {
    let opts;
    try {
        opts = commandLineArgs(definitions, { argv, partial });
    }
    catch (e) {
        quicktype_core_1.assert(!partial, "Partial option parsing should not have failed");
        return quicktype_core_1.messageError("DriverCLIOptionParsingFailed", { message: e.message });
    }
    for (const k of Object.keys(opts)) {
        if (opts[k] === null) {
            return quicktype_core_1.messageError("DriverCLIOptionParsingFailed", {
                message: `Missing value for command line option "${k}"`
            });
        }
    }
    const options = { rendererOptions: {} };
    for (const o of definitions) {
        if (!collection_utils_1.hasOwnProperty(opts, o.name))
            continue;
        const v = opts[o.name];
        if (o.renderer !== undefined)
            options.rendererOptions[o.name] = v;
        else {
            const k = _.lowerFirst(o.name
                .split("-")
                .map(_.upperFirst)
                .join(""));
            options[k] = v;
        }
    }
    return options;
}
function usage(targetLanguages) {
    const rendererSections = [];
    for (const language of targetLanguages) {
        const definitions = language.cliOptionDefinitions.display;
        if (definitions.length === 0)
            continue;
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
function getSourceURIs(options) {
    return __awaiter(this, void 0, void 0, function* () {
        if (options.srcUrls !== undefined) {
            const json = quicktype_core_1.parseJSON(yield quicktype_core_1.readFromFileOrURL(options.srcUrls, options.httpHeader), "URL grammar", options.srcUrls);
            const jsonMap = URLGrammar_1.urlsFromURLGrammar(json);
            const topLevels = Object.getOwnPropertyNames(jsonMap);
            return topLevels.map(name => [name, jsonMap[name]]);
        }
        else if (options.src.length === 0) {
            return [[options.topLevel, ["-"]]];
        }
        else {
            return [];
        }
    });
}
function typeSourcesForURIs(name, uris, options) {
    return __awaiter(this, void 0, void 0, function* () {
        switch (options.srcLang) {
            case "json":
                return [yield sourceFromFileOrUrlArray(name, uris, options.httpHeader)];
            case "schema":
                return uris.map(uri => ({ kind: "schema", name, uris: [uri] }));
            default:
                return quicktype_core_1.panic(`typeSourceForURIs must not be called for source language ${options.srcLang}`);
        }
    });
}
function getSources(options) {
    return __awaiter(this, void 0, void 0, function* () {
        const sourceURIs = yield getSourceURIs(options);
        const sourceArrays = yield Promise.all(sourceURIs.map(([name, uris]) => __awaiter(this, void 0, void 0, function* () { return yield typeSourcesForURIs(name, uris, options); })));
        let sources = [].concat(...sourceArrays);
        const exists = options.src.filter(fs.existsSync);
        const directories = exists.filter(x => fs.lstatSync(x).isDirectory());
        for (const dataDir of directories) {
            sources = sources.concat(yield samplesFromDirectory(dataDir, options.httpHeader));
        }
        // Every src that's not a directory is assumed to be a file or URL
        const filesOrUrls = options.src.filter(x => !_.includes(directories, x));
        if (!_.isEmpty(filesOrUrls)) {
            sources.push(...(yield typeSourcesForURIs(options.topLevel, filesOrUrls, options)));
        }
        return sources;
    });
}
function makeTypeScriptSource(fileNames) {
    const sources = {};
    for (const fileName of fileNames) {
        const baseName = path.basename(fileName);
        sources[baseName] = quicktype_core_1.defined(fs.readFileSync(fileName, "utf8"));
    }
    return Object.assign({ kind: "schema" }, quicktype_typescript_input_1.schemaForTypeScriptSources(sources));
}
function jsonInputForTargetLanguage(targetLanguage, languages, handleJSONRefs = false) {
    if (typeof targetLanguage === "string") {
        targetLanguage = quicktype_core_1.defined(quicktype_core_1.languageNamed(targetLanguage, languages));
    }
    const compressedJSON = new CompressedJSONFromStream_1.CompressedJSONFromStream(targetLanguage.dateTimeRecognizer, handleJSONRefs);
    return new quicktype_core_1.JSONInput(compressedJSON);
}
exports.jsonInputForTargetLanguage = jsonInputForTargetLanguage;
function makeInputData(sources, targetLanguage, additionalSchemaAddresses, handleJSONRefs, httpHeaders) {
    return __awaiter(this, void 0, void 0, function* () {
        const inputData = new quicktype_core_1.InputData();
        for (const source of sources) {
            switch (source.kind) {
                case "graphql":
                    yield inputData.addSource("graphql", source, () => new quicktype_graphql_input_1.GraphQLInput());
                    break;
                case "json":
                    yield inputData.addSource("json", source, () => jsonInputForTargetLanguage(targetLanguage, undefined, handleJSONRefs));
                    break;
                case "schema":
                    yield inputData.addSource("schema", source, () => new quicktype_core_1.JSONSchemaInput(new quicktype_core_1.FetchingJSONSchemaStore(httpHeaders), [], additionalSchemaAddresses));
                    break;
                default:
                    return quicktype_core_1.assertNever(source);
            }
        }
        return inputData;
    });
}
function stringSourceDataToStreamSourceData(src) {
    return { name: src.name, description: src.description, samples: src.samples.map(stringToStream) };
}
function makeQuicktypeOptions(options, targetLanguages) {
    return __awaiter(this, void 0, void 0, function* () {
        if (options.help) {
            usage(targetLanguages === undefined ? quicktype_core_1.defaultTargetLanguages : targetLanguages);
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
            const mc = quicktype_core_1.trainMarkovChain(lines, 3);
            console.log(JSON.stringify(mc));
            return undefined;
        }
        let sources = [];
        let leadingComments = undefined;
        let fixedTopLevels = false;
        switch (options.srcLang) {
            case "graphql":
                let schemaString = undefined;
                let wroteSchemaToFile = false;
                if (options.graphqlIntrospect !== undefined) {
                    schemaString = yield GraphQLIntrospection_1.introspectServer(options.graphqlIntrospect, collection_utils_1.withDefault(options.httpMethod, "POST"), collection_utils_1.withDefault(options.httpHeader, []));
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
                        return quicktype_core_1.messageError("DriverNoGraphQLQueryGiven", {});
                    }
                }
                const gqlSources = [];
                for (const queryFile of options.src) {
                    let schemaFileName = undefined;
                    if (schemaString === undefined) {
                        schemaFileName = quicktype_core_1.defined(options.graphqlSchema);
                        schemaString = fs.readFileSync(schemaFileName, "utf8");
                    }
                    const schema = quicktype_core_1.parseJSON(schemaString, "GraphQL schema", schemaFileName);
                    const query = yield quicktype_core_1.getStream(yield quicktype_core_1.readableFromFileOrURL(queryFile, options.httpHeader));
                    const name = numSources === 1 ? options.topLevel : typeNameFromFilename(queryFile);
                    gqlSources.push({ kind: "graphql", name, schema, query });
                }
                sources = gqlSources;
                break;
            case "json":
            case "schema":
                sources = yield getSources(options);
                break;
            case "typescript":
                sources = [makeTypeScriptSource(options.src)];
                break;
            case "postman":
                for (const collectionFile of options.src) {
                    const collectionJSON = fs.readFileSync(collectionFile, "utf8");
                    const { sources: postmanSources, description } = quicktype_core_1.sourcesFromPostmanCollection(collectionJSON, collectionFile);
                    for (const src of postmanSources) {
                        sources.push(Object.assign({ kind: "json" }, stringSourceDataToStreamSourceData(src)));
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
                return quicktype_core_1.messageError("DriverUnknownSourceLanguage", { lang: options.srcLang });
        }
        const components = collection_utils_1.definedMap(options.debug, d => d.split(","));
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
                }
                else if (component === "print-reconstitution") {
                    debugPrintReconstitution = true;
                }
                else if (component === "print-gather-names") {
                    debugPrintGatherNames = true;
                }
                else if (component === "print-transformations") {
                    debugPrintTransformations = true;
                }
                else if (component === "print-times") {
                    debugPrintTimes = true;
                }
                else if (component === "print-schema-resolving") {
                    debugPrintSchemaResolving = true;
                }
                else if (component === "provenance") {
                    checkProvenance = true;
                }
                else if (component !== "all") {
                    return quicktype_core_1.messageError("DriverUnknownDebugOption", { option: component });
                }
            }
        }
        const lang = quicktype_core_1.languageNamed(options.lang, targetLanguages);
        if (lang === undefined) {
            return quicktype_core_1.messageError("DriverUnknownOutputLanguage", { lang: options.lang });
        }
        const quicktypeOptions = {
            lang,
            alphabetizeProperties: options.alphabetizeProperties,
            allPropertiesOptional: options.allPropertiesOptional,
            fixedTopLevels,
            noRender: options.noRender,
            rendererOptions: options.rendererOptions,
            leadingComments,
            outputFilename: collection_utils_1.definedMap(options.out, path.basename),
            debugPrintGraph,
            checkProvenance,
            debugPrintReconstitution,
            debugPrintGatherNames,
            debugPrintTransformations,
            debugPrintSchemaResolving,
            debugPrintTimes
        };
        for (const flagName of quicktype_core_1.inferenceFlagNames) {
            const cliName = negatedInferenceFlagName(flagName);
            const v = options[cliName];
            if (typeof v === "boolean") {
                quicktypeOptions[flagName] = !v;
            }
            else {
                quicktypeOptions[flagName] = true;
            }
        }
        quicktypeOptions.inputData = yield makeInputData(sources, lang, options.additionalSchema, quicktypeOptions.ignoreJsonRefs !== true, options.httpHeader);
        return quicktypeOptions;
    });
}
exports.makeQuicktypeOptions = makeQuicktypeOptions;
function writeOutput(cliOptions, resultsByFilename) {
    let onFirst = true;
    for (const [filename, { lines, annotations }] of resultsByFilename) {
        const output = lines.join("\n");
        if (cliOptions.out !== undefined) {
            fs.writeFileSync(path.join(path.dirname(cliOptions.out), filename), output);
        }
        else {
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
            if (!(annotation instanceof quicktype_core_1.IssueAnnotationData))
                continue;
            const lineNumber = sa.span.start.line;
            const humanLineNumber = lineNumber + 1;
            console.error(`\nIssue in line ${humanLineNumber}: ${annotation.message}`);
            console.error(`${humanLineNumber}: ${lines[lineNumber]}`);
        }
        onFirst = false;
    }
}
exports.writeOutput = writeOutput;
function main(args) {
    return __awaiter(this, void 0, void 0, function* () {
        let cliOptions;
        if (Array.isArray(args)) {
            cliOptions = parseCLIOptions(args);
        }
        else {
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
        const quicktypeOptions = yield makeQuicktypeOptions(cliOptions);
        if (quicktypeOptions === undefined)
            return;
        const resultsByFilename = yield quicktype_core_1.quicktypeMultiFile(quicktypeOptions);
        writeOutput(cliOptions, resultsByFilename);
    });
}
exports.main = main;
if (require.main === module) {
    main(process.argv.slice(2)).catch(e => {
        if (e instanceof Error) {
            console.error(`Error: ${e.message}.`);
        }
        else {
            console.error(e);
        }
        process.exit(1);
    });
}
