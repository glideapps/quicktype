import * as fs from "fs";
import * as path from "path";
import * as process from "process";
import * as stream from "stream";
import * as getStream from "get-stream";

import * as _ from "lodash";

import { List, Map } from "immutable";

import * as targetLanguages from "./Language/All";
import { OptionDefinition } from "./RendererOptions";
import { TargetLanguage } from "./TargetLanguage";
import { SerializedRenderResult, Annotation, serializeRenderResult } from "./Source";
import { IssueAnnotationData } from "./Annotation";
import { defined, assert } from "./Support";
import { CompressedJSON, Value } from "./CompressedJSON";
import { urlsFromURLGrammar } from "./URLGrammar";
import { combineClasses } from "./CombineClasses";
import { schemaToType } from "./JSONSchemaInput";
import { TypeInference } from "./Inference";
import { inferMaps } from "./InferMaps";
import { TypeGraphBuilder } from "./TypeBuilder";
import { TypeGraph } from "./TypeGraph";

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
    samples: { [name: string]: Value[] };
    schemas: { [name: string]: any };
};

let graphByInputHash: Map<number, TypeGraph> = Map();

class Run {
    private _options: CompleteOptions;
    private _compressedJSON: CompressedJSON;
    private _allSamples: SampleOrSchemaMap;

    constructor(argv: string[] | Options, private readonly _doCache: boolean) {
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

    private getOptionDefinitions = (opts: CompleteOptions): OptionDefinition[] => {
        return getTargetLanguage(opts.lang).optionDefinitions;
    };

    private get isInputJSONSchema(): boolean {
        return this._options.srcLang === "schema";
    }

    private makeGraph = (): TypeGraph => {
        const supportsEnums = getTargetLanguage(this._options.lang).supportsEnums;
        const typeBuilder = new TypeGraphBuilder();
        if (this.isInputJSONSchema) {
            Map(this._allSamples.schemas).forEach((schema, name) => {
                typeBuilder.addTopLevel(name, schemaToType(typeBuilder, name, schema));
            });
            return typeBuilder.finish();
        } else {
            const doInferMaps = !this._options.noMaps;
            const doInferEnums = supportsEnums && !this._options.noEnums;
            const doCombineClasses = !this._options.noCombineClasses;
            const samplesMap = Map(this._allSamples.samples);
            const inputs = List([
                doInferMaps,
                doInferEnums,
                doCombineClasses,
                samplesMap.map(values => List(values)),
                this._compressedJSON
            ]);
            let inputHash: number | undefined = undefined;

            if (this._doCache) {
                inputHash = inputs.hashCode();
                const maybeGraph = graphByInputHash.get(inputHash);
                if (maybeGraph !== undefined) {
                    return maybeGraph;
                }
            }

            const inference = new TypeInference(typeBuilder, doInferMaps, doInferEnums);
            Map(this._allSamples.samples).forEach((cjson, name) => {
                typeBuilder.addTopLevel(
                    name,
                    inference.inferType(this._compressedJSON as CompressedJSON, name, false, cjson)
                );
            });
            let graph = typeBuilder.finish();
            if (doCombineClasses) {
                graph = combineClasses(graph);
            }
            if (doInferMaps) {
                graph = inferMaps(graph);
            }

            if (inputHash !== undefined) {
                graphByInputHash = graphByInputHash.set(inputHash, graph);
            }

            return graph;
        }
    };

    private renderSamplesOrSchemas = (): SerializedRenderResult => {
        const targetLanguage = getTargetLanguage(this._options.lang);
        try {
            const graph = this.makeGraph();
            if (this._options.noRender) {
                return { lines: ["Done.", ""], annotations: List() };
            }
            return targetLanguage.renderGraphAndSerialize(graph, this._options.rendererOptions);
        } catch (e) {
            console.error(e);
            return process.exit(1);
        }
    };

    private splitAndWriteJava = (dir: string, str: string) => {
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

    private readSampleFromStream = async (name: string, readStream: stream.Readable): Promise<void> => {
        if (this.isInputJSONSchema) {
            const input = JSON.parse(await getStream(readStream));
            if (Object.prototype.hasOwnProperty.call(this._allSamples.schemas, name)) {
                console.error(`Error: More than one schema given for top-level ${name}.`);
                return process.exit(1);
            }
            this._allSamples.schemas[name] = input;
        } else {
            const input = await this._compressedJSON.readFromStream(readStream);
            if (!Object.prototype.hasOwnProperty.call(this._allSamples.samples, name)) {
                this._allSamples.samples[name] = [];
            }
            this._allSamples.samples[name].push(input);
        }
    };

    private readSampleFromFileOrUrl = async (name: string, fileOrUrl: string): Promise<void> => {
        if (fs.existsSync(fileOrUrl)) {
            await this.readSampleFromStream(name, fs.createReadStream(fileOrUrl));
        } else {
            const res = await fetch(fileOrUrl);
            await this.readSampleFromStream(name, res.body);
        }
    };

    private readSampleFromFileOrUrlArray = async (name: string, filesOrUrls: string[]): Promise<void> => {
        for (const fileOrUrl of filesOrUrls) {
            await this.readSampleFromFileOrUrl(name, fileOrUrl);
        }
    };

    private readNamedSamplesFromDirectory = async (dataDir: string): Promise<void> => {
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

    run = async (): Promise<SerializedRenderResult> => {
        assert(!this._options.help, "Cannot print help when run without printing");
        if (this._options.srcUrls) {
            let json = JSON.parse(fs.readFileSync(this._options.srcUrls, "utf8"));
            let jsonMap = urlsFromURLGrammar(json);
            for (let key of Object.keys(jsonMap)) {
                await this.readSampleFromFileOrUrlArray(key, jsonMap[key]);
            }
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
        return this.renderSamplesOrSchemas();
    };

    runAndPrint = async () => {
        if (this._options.help) {
            usage();
            return;
        }

        const { lines, annotations } = await this.run();
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

    // Parse the options in argv and split them into global options and renderer options,
    // according to each option definition's `renderer` field.  If `partial` is false this
    // will throw if it encounters an unknown option.
    private parseOptions = (definitions: OptionDefinition[], argv: string[], partial: boolean): CompleteOptions => {
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

    private inferOptions = (opts: Options): CompleteOptions => {
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

    private inferLang = (options: Options): string => {
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

    private inferTopLevel = (options: Options): string => {
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
        let run = new Run(args, false);
        await run.runAndPrint();
    }
}

if (require.main === module) {
    main(process.argv.slice(2)).catch(reason => {
        console.error(reason);
        process.exit(1);
    });
}
