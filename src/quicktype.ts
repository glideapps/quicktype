import * as fs from "fs";
import * as path from "path";
import * as process from "process";
import * as stream from "stream";
import * as getStream from "get-stream";

import * as _ from "lodash";

import { Config, TopLevelConfig } from "./Config";
import * as targetLanguages from "./Language/All";
import { OptionDefinition } from "./RendererOptions";
import { TargetLanguage } from "./TargetLanguage";
import { SerializedRenderResult, Annotation } from "./Source";
import { IssueAnnotationData } from "./Annotation";
import { defined } from "./Support";
import { CompressedJSON, Value } from "./CompressedJSON";
import { urlsFromURLGrammar } from "./URLGrammar";
import { readGraphQLSchema } from "./GraphQL";

const commandLineArgs = require("command-line-args");
const getUsage = require("command-line-usage");
const fetch = require("node-fetch");
const chalk = require("chalk");

const langs = targetLanguages.all.map(r => _.minBy(r.names, s => s.length)).join("|");
const langDisplayNames = targetLanguages.all.map(r => r.displayName).join(", ");

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
        defaultValue: "json",
        typeLabel: "json|schema",
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
        name: "graphql-query",
        type: String,
        typeLabel: "FILE",
        description: "GraphQL query file."
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

function getTargetLanguage(name: string): TargetLanguage {
    const language = targetLanguages.languageNamed(name);
    if (language) {
        return language;
    }
    console.error(`'${name}' is not yet supported as an output language.`);
    return process.exit(1);
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

export type RendererOptions = { [name: string]: string };

export interface Options {
    lang?: string;
    src?: string[];
    topLevel?: string;
    srcLang?: string;
    srcUrls?: string;
    graphqlSchema?: string;
    graphqlQuery?: string;
    out?: string;
    noMaps?: boolean;
    noEnums?: boolean;
    noCombineClasses?: boolean;
    noRender?: boolean;
    help?: boolean;
    quiet?: boolean;
    rendererOptions: RendererOptions;
}

interface CompleteOptions {
    lang: string;
    src: string[];
    topLevel: string;
    srcLang: string;
    srcUrls?: string;
    graphqlSchema?: string;
    graphqlQuery?: string;
    out?: string;
    noMaps: boolean;
    noEnums: boolean;
    noCombineClasses: boolean;
    noRender: boolean;
    help: boolean;
    quiet: boolean;
    rendererOptions: RendererOptions;
}

type SampleOrSchemaMap = {
    samples: { [name: string]: any[] };
    schemas: { [name: string]: any };
};

class Run {
    private _options: CompleteOptions;
    private _compressedJSON: CompressedJSON;
    private _allSamples: SampleOrSchemaMap;

    constructor(argv: string[] | Options) {
        if (_.isArray(argv)) {
            // We can only fully parse the options once we know which renderer is selected,
            // because there are renderer-specific options.  But we only know which renderer
            // is selected after we've parsed the options.  Hence, we parse the options
            // twice.  This is the first parse to get the renderer:
            const incompleteOptions = this.parseOptions(optionDefinitions, argv, true);
            const rendererOptionDefinitions = this.getOptionDefinitions(incompleteOptions);
            // Use the global options as well as the renderer options from now on:
            const allOptionDefinitions = _.concat(optionDefinitions, rendererOptionDefinitions);
            try {
                // This is the parse that counts:
                this._options = this.parseOptions(allOptionDefinitions, argv, false);
            } catch (error) {
                if (error.name === "UNKNOWN_OPTION") {
                    console.error("Error: Unknown option");
                    usage();
                    process.exit(1);
                }
                throw error;
            }
        } else {
            this._options = this.inferOptions(argv);
        }
        this._compressedJSON = new CompressedJSON();
        this._allSamples = { samples: {}, schemas: {} };
    }

    getOptionDefinitions = (opts: CompleteOptions): OptionDefinition[] => {
        return getTargetLanguage(opts.lang).optionDefinitions;
    };

    get isInputJSONSchema(): boolean {
        return this._options.srcLang === "schema";
    }

    get needCompressedJSONInput(): boolean {
        if (this.isInputJSONSchema) {
            return false;
        }
        const lang = getTargetLanguage(this._options.lang);
        return lang.needsCompressedJSONInput(this._options.rendererOptions);
    }

    renderSamplesOrSchemas = (): SerializedRenderResult => {
        const targetLanguage = getTargetLanguage(this._options.lang);

        let topLevels: TopLevelConfig[];
        if (this.isInputJSONSchema) {
            const names = Object.getOwnPropertyNames(this._allSamples.schemas);
            topLevels = names.map(name => ({ name, schema: this._allSamples.schemas[name] }));
        } else {
            const names = Object.getOwnPropertyNames(this._allSamples.samples);
            topLevels = names.map(name => ({ name, samples: this._allSamples.samples[name] }));
        }
        let config: Config = {
            language: targetLanguage.names[0],
            isInputJSONSchema: this.isInputJSONSchema,
            topLevels,
            compressedJSON: this._compressedJSON,
            inferMaps: !this._options.noMaps,
            inferEnums: !this._options.noEnums,
            combineClasses: !this._options.noCombineClasses,
            doRender: !this._options.noRender,
            rendererOptions: this._options.rendererOptions
        };

        try {
            return targetLanguage.transformAndRenderConfig(config);
        } catch (e) {
            console.error(e);
            return process.exit(1);
        }
    };

    renderSamplesOrSchemas = (samplesOrSchemas: SampleOrSchemaMap): SerializedRenderResult => {
        const areSchemas = this.options.srcLang === "schema";
        const topLevels = Object.getOwnPropertyNames(samplesOrSchemas).map(name => {
            if (areSchemas) {
                // Only one schema per top-level is used right now
                return { name, schema: samplesOrSchemas[name][0] };
            } else {
                return { name, samples: samplesOrSchemas[name] };
            }
        });
        return this.renderTopLevels(topLevels);
    };

    splitAndWriteJava = (dir: string, str: string) => {
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
    };

    render = () => {
        const { lines, annotations } = this.renderSamplesOrSchemas();
        const output = lines.join("\n");
        if (this._options.out) {
            if (this._options.lang === "java") {
                this.splitAndWriteJava(path.dirname(this._options.out), output);
            } else {
                fs.writeFileSync(this._options.out, output);
            }
        } else {
            process.stdout.write(output);
        }
        if (this._options.quiet) {
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
    };

    readSampleFromStream = async (name: string, readStream: stream.Readable): Promise<void> => {
        let input: any;
        if (this.needCompressedJSONInput) {
            input = await this._compressedJSON.readFromStream(readStream);
        } else {
            input = JSON.parse(await getStream(readStream));
        }
        if (this.isInputJSONSchema) {
            if (Object.prototype.hasOwnProperty.call(this._allSamples.schemas, name)) {
                console.error(`Error: More than one schema given for top-level ${name}.`);
                return process.exit(1);
            }
            this._allSamples.schemas[name] = input;
        } else {
            if (!Object.prototype.hasOwnProperty.call(this._allSamples.samples, name)) {
                this._allSamples.samples[name] = [];
            }
            this._allSamples.samples[name].push(input);
        }
    };

    readSampleFromFileOrUrl = async (name: string, fileOrUrl: string): Promise<void> => {
        if (fs.existsSync(fileOrUrl)) {
            await this.readSampleFromStream(name, fs.createReadStream(fileOrUrl));
        } else {
            const res = await fetch(fileOrUrl);
            await this.readSampleFromStream(name, res.body);
        }
    };

    readSampleFromFileOrUrlArray = async (name: string, filesOrUrls: string[]): Promise<void> => {
        for (const fileOrUrl of filesOrUrls) {
            await this.readSampleFromFileOrUrl(name, fileOrUrl);
        }
    };

    readNamedSamplesFromDirectory = async (dataDir: string): Promise<void> => {
        const readFilesOrURLsInDirectory = async (d: string, sampleName?: string): Promise<void> => {
            const files = fs
                .readdirSync(d)
                .map(x => path.join(d, x))
                .filter(x => fs.lstatSync(x).isFile());
            // Each file is a (Name, JSON | URL)
            for (const file of files) {
                if (sampleName === undefined) {
                    const name = path.basename(file);
                    sampleName = name.substr(0, name.lastIndexOf("."));
                }

                let fileOrUrl = file;
                // If file is a URL string, download it
                if (_.endsWith(file, ".url")) {
                    fileOrUrl = fs.readFileSync(file, "utf8").trim();
                }

                await this.readSampleFromFileOrUrl(sampleName, fileOrUrl);
            }
        };

        const contents = fs.readdirSync(dataDir).map(x => path.join(dataDir, x));
        const directories = contents.filter(x => fs.lstatSync(x).isDirectory());

        await readFilesOrURLsInDirectory(dataDir);
        for (const dir of directories) {
            const sampleName = path.basename(dir);
            await readFilesOrURLsInDirectory(dir, sampleName);
        }
    };

    main = async () => {
        if (this._options.help) {
            usage();
            return;
        } else if (this._options.srcUrls) {
            let json = JSON.parse(fs.readFileSync(this._options.srcUrls, "utf8"));
            let jsonMap = urlsFromURLGrammar(json);
            for (let key of Object.keys(jsonMap)) {
                await this.readSampleFromFileOrUrlArray(key, jsonMap[key]);
            }
        } else if (this.options.graphqlSchema) {
            if (!this.options.graphqlQuery) {
                console.error("Please specify a GraphQL query with --graphql-query.");
                return process.exit(1);
            }
            let json = JSON.parse(fs.readFileSync(this.options.graphqlSchema, "utf8"));
            let query = fs.readFileSync(this.options.graphqlQuery, "utf8");
            const topLevel = {
                name: this.options.topLevel,
                graphQLSchema: json,
                graphQLDocument: query
            };
            this.produceOutput(this.renderTopLevels([topLevel]));
        } else if (this._options.src.length === 0) {
            // FIXME: Why do we have to convert to any here?
            await this.readSampleFromStream(this._options.topLevel, process.stdin as any);
        } else {
            const exists = this._options.src.filter(fs.existsSync);
            const directories = exists.filter(x => fs.lstatSync(x).isDirectory());

            for (const dataDir of directories) {
                await this.readNamedSamplesFromDirectory(dataDir);
            }

            // Every src that's not a directory is assumed to be a file or URL
            const filesOrUrls = this._options.src.filter(x => !_.includes(directories, x));
            if (!_.isEmpty(filesOrUrls)) {
                await this.readSampleFromFileOrUrlArray(this._options.topLevel, filesOrUrls);
            }
        }
        this.render();
    };

    // Parse the options in argv and split them into global options and renderer options,
    // according to each option definition's `renderer` field.  If `partial` is false this
    // will throw if it encounters an unknown option.
    parseOptions = (definitions: OptionDefinition[], argv: string[], partial: boolean): CompleteOptions => {
        const opts: { [key: string]: any } = commandLineArgs(definitions, {
            argv,
            partial: partial
        });
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
        return this.inferOptions(options);
    };

    inferOptions = (opts: Options): CompleteOptions => {
        return {
            src: opts.src || [],
            srcLang: opts.srcLang || "json",
            lang: opts.lang || this.inferLang(opts),
            topLevel: opts.topLevel || this.inferTopLevel(opts),
            noMaps: !!opts.noMaps,
            noEnums: !!opts.noEnums,
            noCombineClasses: !!opts.noCombineClasses,
            noRender: !!opts.noRender,
            help: !!opts.help,
            quiet: !!opts.quiet,
            ...opts
        };
    };

    inferLang = (options: Options): string => {
        // Output file extension determines the language if language is undefined
        if (options.out) {
            let extension = path.extname(options.out);
            if (extension === "") {
                console.error("Please specify a language (--lang) or an output file extension.");
                process.exit(1);
            }
            return extension.substr(1);
        }

        return "go";
    };

    inferTopLevel = (options: Options): string => {
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
    };
}

export async function main(args: string[] | Options) {
    if (_.isArray(args) && args.length === 0) {
        usage();
    } else {
        let run = new Run(args);
        await run.main();
    }
}

if (require.main === module) {
    main(process.argv.slice(2)).catch(reason => {
        console.error(reason);
        process.exit(1);
    });
}
