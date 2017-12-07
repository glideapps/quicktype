import * as fs from "fs";
import * as path from "path";

import * as _ from "lodash";
import { Run, Source, Sample, RendererOptions, getTargetLanguage, SourceType } from ".";
import { OptionDefinition } from "./RendererOptions";
import * as targetLanguages from "./Language/All";
import { urlsFromURLGrammar } from "./URLGrammar";
import { Annotation } from "./Source";
import { IssueAnnotationData } from "./Annotation";
import { Readable } from "stream";
import { panic, assert, defined } from "./Support";

const commandLineArgs = require("command-line-args");
const getUsage = require("command-line-usage");
const chalk = require("chalk");
const fetch = require("node-fetch");

const langs = targetLanguages.all.map(r => _.minBy(r.names, s => s.length)).join("|");
const langDisplayNames = targetLanguages.all.map(r => r.displayName).join(", ");

export interface CLIOptions {
    lang: string;
    topLevel: string;
    src: string[];
    srcUrls?: string;
    srcLang: string;
    graphqlSchema?: string;
    out?: string;

    noMaps: boolean;
    noEnums: boolean;
    noCombineClasses: boolean;
    noRender: boolean;

    rendererOptions: RendererOptions;

    help: boolean;
    quiet: boolean;
}

async function sampleFromFileOrUrl(fileOrUrl: string): Promise<Sample<Readable>> {
    if (fs.existsSync(fileOrUrl)) {
        return { source: fs.createReadStream(fileOrUrl) };
    } else {
        const response = await fetch(fileOrUrl);
        return { source: response.body };
    }
}

async function sourceFromFileOrUrlArray(name: string, filesOrUrls: string[]): Promise<Source<Readable>> {
    const samples = await Promise.all(filesOrUrls.map(sampleFromFileOrUrl));
    return { name, samples };
}

async function samplesFromDirectory(dataDir: string): Promise<Source<Readable>[]> {
    async function readFilesOrURLsInDirectory(d: string) {
        const files = fs
            .readdirSync(d)
            .map(x => path.join(d, x))
            .filter(x => fs.lstatSync(x).isFile());
        // Each file is a (Name, JSON | URL)
        return Promise.all(
            files.map(async file => {
                const name = path.basename(file);
                const inferredName = name.substr(0, name.lastIndexOf("."));

                let fileOrUrl = file;
                // If file is a URL string, download it
                if (_.endsWith(file, ".url")) {
                    fileOrUrl = fs.readFileSync(file, "utf8").trim();
                }

                return {
                    inferredName,
                    sample: await sampleFromFileOrUrl(fileOrUrl)
                };
            })
        );
    }

    const contents = fs.readdirSync(dataDir).map(x => path.join(dataDir, x));
    const directories = contents.filter(x => fs.lstatSync(x).isDirectory());
    const topLevelSamples = await readFilesOrURLsInDirectory(dataDir);

    let sources: Source<Readable>[] = [];

    for (const topLevel of topLevelSamples) {
        sources.push({
            name: topLevel.inferredName,
            samples: [topLevel.sample]
        });
    }

    for (const dir of directories) {
        const samples = await readFilesOrURLsInDirectory(dir);
        sources.push({
            name: path.basename(dir),
            samples: samples.map(x => x.sample)
        });
    }

    return sources;
}

function inferLang(options: Partial<CLIOptions>): string {
    // Output file extension determines the language if language is undefined
    if (options.out) {
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
    if (options.out) {
        let extension = path.extname(options.out);
        let without = path.basename(options.out).replace(extension, "");
        return without;
    }

    // Source determines the top-level if undefined
    if (options.src && options.src.length === 1) {
        let src = options.src[0];
        let extension = path.extname(src);
        let without = path.basename(src).replace(extension, "");
        return without;
    }

    return "TopLevel";
}

function inferOptions(opts: Partial<CLIOptions>): CLIOptions {
    let srcLang = opts.srcLang;
    if (opts.graphqlSchema !== undefined) {
        assert(
            srcLang === undefined || srcLang === "graphql",
            "If a GraphQL schema is specified, the source language must be GraphQL"
        );
        srcLang = "graphql";
    } else {
        assert(srcLang !== "graphql", "Please specify a GraphQL schema with --graphql-schema");
        srcLang = srcLang || "json";
    }

    return {
        src: opts.src || [],
        srcLang: srcLang,
        lang: opts.lang || inferLang(opts),
        topLevel: opts.topLevel || inferTopLevel(opts),
        noMaps: !!opts.noMaps,
        noEnums: !!opts.noEnums,
        noCombineClasses: !!opts.noCombineClasses,
        noRender: !!opts.noRender,
        rendererOptions: opts.rendererOptions || {},
        help: opts.help || false,
        quiet: opts.quiet || false,
        out: opts.out,
        graphqlSchema: opts.graphqlSchema
    };
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
        typeLabel: "json|schema|graphql",
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
        name: "graphql-schema",
        type: String,
        typeLabel: "FILE",
        description: "GraphQL introspection file."
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
        name: "no-render",
        type: Boolean,
        description: "Don't render output."
    },
    {
        name: "quiet",
        type: Boolean,
        description: "Don't show issues in the generated code."
    },
    {
        name: "help",
        alias: "h",
        type: Boolean,
        description: "Get some help."
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
        hide: ["no-render"]
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

function getOptionDefinitions(opts: CLIOptions): OptionDefinition[] {
    return getTargetLanguage(opts.lang).optionDefinitions;
}

function parseArgv(argv: string[]): CLIOptions {
    // We can only fully parse the options once we know which renderer is selected,
    // because there are renderer-specific options.  But we only know which renderer
    // is selected after we've parsed the options.  Hence, we parse the options
    // twice.  This is the first parse to get the renderer:
    const incompleteOptions = parseOptions(optionDefinitions, argv, true);
    const rendererOptionDefinitions = getOptionDefinitions(incompleteOptions);
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
    const options: { rendererOptions: RendererOptions; [key: string]: any } = { rendererOptions: {} };
    definitions.forEach(o => {
        if (!(o.name in opts)) return;
        const v = opts[o.name];
        if (o.renderer) options.rendererOptions[o.name] = v;
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
    return inferOptions(options);
}

function usage() {
    const rendererSections: UsageSection[] = [];

    _.forEach(targetLanguages.all, language => {
        const definitions = language.optionDefinitions;
        if (definitions.length === 0) return;

        rendererSections.push({
            header: `Options for ${language.displayName}`,
            optionList: definitions
        });
    });

    const sections = _.concat(sectionsBeforeRenderers, rendererSections, sectionsAfterRenderers);

    console.log(getUsage(sections));
}

function splitAndWriteJava(dir: string, str: string) {
    const lines = str.split("\n");
    let filename: string | null = null;
    let currentFileContents: string = "";

    const writeFile = () => {
        if (filename != null) {
            fs.writeFileSync(path.join(dir, filename), currentFileContents);
        }
        filename = null;
        currentFileContents = "";
    };

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        i += 1;

        const results = line.match("^// (.+\\.java)$");
        if (results == null) {
            currentFileContents += line + "\n";
        } else {
            writeFile();
            filename = results[1];
            while (lines[i] === "") i++;
        }
    }
    writeFile();
}

async function getSources(options: CLIOptions): Promise<Source<Readable>[]> {
    if (options.srcUrls) {
        const json = JSON.parse(fs.readFileSync(options.srcUrls, "utf8"));
        const jsonMap = urlsFromURLGrammar(json);
        const topLevels = Object.getOwnPropertyNames(jsonMap);
        return Promise.all(topLevels.map(name => sourceFromFileOrUrlArray(name, jsonMap[name])));
    } else if (options.src.length === 0) {
        return [
            {
                name: options.topLevel,
                samples: [{ source: process.stdin }]
            }
        ];
    } else {
        const exists = options.src.filter(fs.existsSync);
        const directories = exists.filter(x => fs.lstatSync(x).isDirectory());

        let sources: Source<Readable>[] = [];
        for (const dataDir of directories) {
            sources = sources.concat(await samplesFromDirectory(dataDir));
        }

        // Every src that's not a directory is assumed to be a file or URL
        const filesOrUrls = options.src.filter(x => !_.includes(directories, x));
        if (!_.isEmpty(filesOrUrls)) {
            sources.push(await sourceFromFileOrUrlArray(options.topLevel, filesOrUrls));
        }

        return sources;
    }
}

export async function main(args: string[] | Partial<CLIOptions>) {
    if (_.isArray(args) && args.length === 0) {
        usage();
    } else {
        let options = _.isArray(args) ? parseArgv(args) : inferOptions(args);

        if (options.help) {
            usage();
            return;
        }

        let sources: SourceType<string | Readable> | undefined;
        switch (options.srcLang) {
            case "graphql":
                if (options.src.length !== 1) {
                    return panic("Please specify one GraphQL query as input.");
                }
                const queryFile = options.src[0];
                const schemaFile = defined(options.graphqlSchema);
                const schema = JSON.parse(fs.readFileSync(schemaFile, "utf8"));
                const query = fs.readFileSync(queryFile, "utf8");
                sources = { topLevelName: options.topLevel, schema, query };
                break;
            case "json":
                sources = await getSources(options);
                break;
            case "schema":
                // Collect sources as JSON, then map to schema data
                let jsonSources = await getSources(options);
                sources = jsonSources.map(jsonSource => {
                    assert(jsonSource.samples.length === 1, `Please specify one schema file for ${jsonSource.name}`);
                    return {
                        name: jsonSource.name,
                        schema: jsonSource.samples[0].source
                    };
                });
                break;
            default:
                panic(`Unsupported source language (${options.srcLang})`);
                break;
        }

        let run = new Run(
            {
                lang: options.lang,
                sources,
                inferMaps: !options.noMaps,
                inferEnums: !options.noEnums,
                combineClasses: !options.noCombineClasses,
                noRender: options.noRender,
                rendererOptions: options.rendererOptions
            },
            false
        );

        const { lines, annotations } = await run.run();
        const output = lines.join("\n");

        if (options.out) {
            if (options.lang === "java") {
                splitAndWriteJava(path.dirname(options.out), output);
            } else {
                fs.writeFileSync(options.out, output);
            }
        } else {
            process.stdout.write(output);
        }
        if (options.quiet) {
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
    }
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
