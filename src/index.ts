import * as getStream from "get-stream";
import * as _ from "lodash";
import { List, Map } from "immutable";
import { Readable } from "stream";

import * as targetLanguages from "./Language/All";
import { OptionDefinition } from "./RendererOptions";
import { TargetLanguage } from "./TargetLanguage";
import { SerializedRenderResult, Annotation, serializeRenderResult } from "./Source";
import { IssueAnnotationData } from "./Annotation";
import { defined, assert, panic } from "./Support";
import { CompressedJSON, Value } from "./CompressedJSON";
import { urlsFromURLGrammar } from "./URLGrammar";
import { combineClasses } from "./CombineClasses";
import { schemaToType } from "./JSONSchemaInput";
import { TypeInference } from "./Inference";
import { inferMaps } from "./InferMaps";
import { TypeGraphBuilder } from "./TypeBuilder";
import { TypeGraph } from "./TypeGraph";
import { readGraphQLSchema } from "./GraphQL";

// Re-export essential types and functions
export { TargetLanguage } from "./TargetLanguage";
export { SerializedRenderResult, Annotation } from "./Source";
export { all as languages, languageNamed } from "./Language/All";
export { OptionDefinition } from "./RendererOptions";

const stringToStream = require("string-to-stream");

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

function isSourceData<T>(sources: SourceType<T>): sources is Source<T>[] {
    if (_.isArray(sources)) {
        if (sources.length === 0) {
            panic("You must provide at least one sample");
        }
        return "samples" in sources[0];
    }
    return false;
}

export interface SchemaData<T> {
    name: string;
    schema: T;
}

function isSchemaData<T>(sources: SourceType<T>): sources is SchemaData<T>[] {
    if (_.isArray(sources)) {
        if (sources.length === 0) {
            panic("You must provide at least one sample");
        }
        return "schema" in sources[0];
    }
    return false;
}

export interface GraphQLData {
    topLevelName: string;
    schema: any;
    query: string;
}

function isGraphQLData<T>(sources: SourceType<T>): sources is GraphQLData {
    return "schema" in sources;
}

export type SourceType<T> = GraphQLData | Source<T>[] | SchemaData<T>[];

export interface Options {
    lang: string;
    sources: SourceType<string | Readable>;
    inferMaps: boolean;
    inferEnums: boolean;
    combineClasses: boolean;
    noRender: boolean;
    rendererOptions: RendererOptions;
}

const defaultOptions = {
    lang: "ts",
    sources: [],
    inferMaps: true,
    inferEnums: true,
    combineClasses: true,
    noRender: false,
    rendererOptions: {}
};

type InputData = {
    samples: { [name: string]: Value[] };
    schemas: { [name: string]: any };
    graphQLs: { [name: string]: { schema: any; query: string } };
};

let graphByInputHash: Map<number, TypeGraph> = Map();

function toReadable(source: string | Readable): Readable {
    return _.isString(source) ? stringToStream(source) : source;
}

export class Run {
    private _compressedJSON: CompressedJSON;
    private _allInputs: InputData;
    private _options: Options;

    constructor(options: Partial<Options>, private readonly _doCache: boolean) {
        this._compressedJSON = new CompressedJSON();

        this._options = _.assign(_.clone(defaultOptions), options);
        this._allInputs = { samples: {}, schemas: {}, graphQLs: {} };
    }

    private get isInputJSONSchema(): boolean {
        return isSchemaData(this._options.sources);
    }

    private get isInputGraphQL(): boolean {
        return isGraphQLData(this._options.sources);
    }

    private makeGraph = (): TypeGraph => {
        const supportsEnums = getTargetLanguage(this._options.lang).supportsEnums;
        const typeBuilder = new TypeGraphBuilder();
        if (this.isInputJSONSchema) {
            Map(this._allInputs.schemas).forEach((schema, name) => {
                typeBuilder.addTopLevel(name, schemaToType(typeBuilder, name, schema));
            });
            return typeBuilder.finish();
        } else if (this.isInputGraphQL) {
            Map(this._allInputs.graphQLs).forEach(({ schema, query }, name) => {
                typeBuilder.addTopLevel(name, readGraphQLSchema(typeBuilder, schema, query));
            });
            return typeBuilder.finish();
        } else {
            const doInferMaps = this._options.inferMaps;
            const doInferEnums = supportsEnums && this._options.inferEnums;
            const doCombineClasses = this._options.combineClasses;
            const samplesMap = Map(this._allInputs.samples);
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
            Map(this._allInputs.samples).forEach((cjson, name) => {
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
            if (_.has(this._allInputs.schemas, name)) {
                throw new Error(`More than one schema given for ${name}`);
            }
            this._allInputs.schemas[name] = input;
        } else {
            const input = await this._compressedJSON.readFromStream(readStream);
            if (!_.has(this._allInputs.samples, name)) {
                this._allInputs.samples[name] = [];
            }
            this._allInputs.samples[name].push(input);
        }
    };

    public run = async (): Promise<SerializedRenderResult> => {
        const targetLanguage = getTargetLanguage(this._options.lang);

        if (isGraphQLData(this._options.sources)) {
            const { topLevelName, schema, query } = this._options.sources;
            this._allInputs.graphQLs[topLevelName] = { schema, query };
        } else if (isSourceData(this._options.sources)) {
            for (const source of this._options.sources) {
                for (const sample of source.samples) {
                    await this.readSampleFromStream(source.name, toReadable(sample.source));
                }
            }
        } else if (isSchemaData(this._options.sources)) {
            for (const { name, schema } of this._options.sources) {
                await this.readSampleFromStream(name, toReadable(schema));
            }
        }

        const graph = this.makeGraph();

        if (this._options.noRender) {
            return { lines: ["Done.", ""], annotations: List() };
        }

        return targetLanguage.renderGraphAndSerialize(graph, this._options.rendererOptions);
    };
}

export function quicktype(options: Partial<Options>, useCache: boolean = true) {
    return new Run(options, useCache).run();
}
