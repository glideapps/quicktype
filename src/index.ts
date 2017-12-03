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

const stringToStream = require("string-to-stream");
const fetch = require("node-fetch");

export function getTargetLanguage(name: string): TargetLanguage {
    const language = targetLanguages.languageNamed(name);
    if (language) {
        return language;
    }
    throw new Error(`'${name}' is not yet supported as an output language.`);
}

export type RendererOptions = { [name: string]: string };

export interface Options {
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

function inferTopLevel(options: Partial<Options>): string {
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

function inferLang(options: Partial<Options>): string {
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

export function inferOptions(opts: Partial<Options>): Options {
    return {
        src: opts.src || [],
        srcLang: opts.srcLang || "json",
        lang: opts.lang || inferLang(opts),
        topLevel: opts.topLevel || inferTopLevel(opts),
        noMaps: !!opts.noMaps,
        noEnums: !!opts.noEnums,
        noCombineClasses: !!opts.noCombineClasses,
        noRender: !!opts.noRender,
        help: !!opts.help,
        quiet: !!opts.quiet,
        rendererOptions: opts.rendererOptions || {}
    };
}

export class Run {
    private _options: Options;
    private _compressedJSON: CompressedJSON;
    private _allSamples: SampleOrSchemaMap;

    constructor(options: Partial<Options>, private readonly _doCache: boolean) {
        this._options = inferOptions(options);
        this._compressedJSON = new CompressedJSON();
        this._allSamples = { samples: {}, schemas: {} };
    }

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
        const graph = this.makeGraph();
        if (this._options.noRender) {
            return { lines: ["Done.", ""], annotations: List() };
        }
        return targetLanguage.renderGraphAndSerialize(graph, this._options.rendererOptions);
    };

    private readSampleFromStream = async (name: string, readStream: stream.Readable): Promise<void> => {
        if (this.isInputJSONSchema) {
            const input = JSON.parse(await getStream(readStream));
            if (_.has(this._allSamples.schemas, name)) {
                throw new Error(`More than one schema given for ${name}`);
            }
            this._allSamples.schemas[name] = input;
        } else {
            const input = await this._compressedJSON.readFromStream(readStream);
            if (!_.has(this._allSamples.samples, name)) {
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

    public runWeb = async (sources: Array<{ name: string; samples: string[] }>): Promise<SerializedRenderResult> => {
        for (const { name, samples } of sources) {
            for (const sample of samples) {
                await this.readSampleFromStream(name, stringToStream(sample));
            }
        }
        return this.renderSamplesOrSchemas();
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
}
