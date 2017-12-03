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
import { Readable } from "stream";

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

export interface Sample<T> {
    source: T;
}

export interface Source<T> {
    name: string;
    samples: Sample<T>[];
}

export interface Options {
    lang: string;
    srcLang: string;
    noMaps: boolean;
    noEnums: boolean;
    noCombineClasses: boolean;
    noRender: boolean;
    rendererOptions: RendererOptions;
}

type SampleOrSchemaMap = {
    samples: { [name: string]: Value[] };
    schemas: { [name: string]: any };
};

let graphByInputHash: Map<number, TypeGraph> = Map();

export class Run {
    private _compressedJSON: CompressedJSON;
    private _allSamples: SampleOrSchemaMap;

    constructor(private readonly _options: Options, private readonly _doCache: boolean) {
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

    private readSampleFromStream = async (name: string, readStream: Readable): Promise<void> => {
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

    public run = async (sources: Source<string | Readable>[]): Promise<SerializedRenderResult> => {
        const targetLanguage = getTargetLanguage(this._options.lang);

        for (const source of sources) {
            for (const sample of source.samples) {
                const stream = _.isString(sample) ? stringToStream(sample) : sample;
                await this.readSampleFromStream(source.name, stream);
            }
        }

        const graph = this.makeGraph();

        if (this._options.noRender) {
            return { lines: ["Done.", ""], annotations: List() };
        }

        return targetLanguage.renderGraphAndSerialize(graph, this._options.rendererOptions);
    };
}
