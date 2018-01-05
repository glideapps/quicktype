import { getStream } from "./get-stream";
import * as _ from "lodash";
import { List, Map } from "immutable";
import { Readable } from "stream";

import * as targetLanguages from "./Language/All";
import { TargetLanguage } from "./TargetLanguage";
import { SerializedRenderResult } from "./Source";
import { assertNever } from "./Support";
import { CompressedJSON, Value } from "./CompressedJSON";
import { combineClasses } from "./CombineClasses";
import { schemaToType } from "./JSONSchemaInput";
import { TypeInference } from "./Inference";
import { inferMaps } from "./InferMaps";
import { TypeGraphBuilder } from "./TypeBuilder";
import { TypeGraph, noneToAny } from "./TypeGraph";
import { makeGraphQLQueryTypes } from "./GraphQL";
import { gatherNames } from "./GatherNames";
import { makeTypeNames } from "./TypeNames";
import { inferEnums } from "./InferEnums";

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

export type StringInput = string | Readable;

export interface JSONTypeSource {
    name: string;
    samples: StringInput[];
}

export function isJSONSource(source: TypeSource): source is JSONTypeSource {
    return "samples" in source;
}

export interface SchemaTypeSource {
    name: string;
    schema: StringInput;
}

export function isSchemaSource(source: TypeSource): source is SchemaTypeSource {
    return !("query" in source) && !("samples" in source);
}

export interface GraphQLTypeSource {
    name: string;
    schema: any;
    query: StringInput;
}

export function isGraphQLSource(source: TypeSource): source is GraphQLTypeSource {
    return "query" in source;
}

export type TypeSource = GraphQLTypeSource | JSONTypeSource | SchemaTypeSource;

export interface Options {
    lang: string;
    sources: TypeSource[];
    inferMaps: boolean;
    inferEnums: boolean;
    alphabetizeProperties: boolean;
    combineClasses: boolean;
    noRender: boolean;
    leadingComments: string[] | undefined;
    rendererOptions: RendererOptions;
    indentation: string | undefined;
}

const defaultOptions: Options = {
    lang: "ts",
    sources: [],
    inferMaps: true,
    inferEnums: true,
    alphabetizeProperties: false,
    combineClasses: true,
    noRender: false,
    leadingComments: undefined,
    rendererOptions: {},
    indentation: undefined
};

type InputData = {
    samples: { [name: string]: Value[] };
    schemas: { [name: string]: any };
    graphQLs: { [name: string]: { schema: any; query: string } };
};

function toReadable(source: string | Readable): Readable {
    return _.isString(source) ? stringToStream(source) : source;
}

async function toString(source: string | Readable): Promise<string> {
    return _.isString(source) ? source : await getStream(source);
}

export class Run {
    private _compressedJSON: CompressedJSON;
    private _allInputs: InputData;
    private _options: Options;

    constructor(options: Partial<Options>) {
        this._options = _.assign(_.clone(defaultOptions), options);
        this._allInputs = { samples: {}, schemas: {}, graphQLs: {} };

        const mapping = getTargetLanguage(this._options.lang).stringTypeMapping;
        const makeDate = mapping.date !== "string";
        const makeTime = mapping.time !== "string";
        const makeDateTime = mapping.dateTime !== "string";
        this._compressedJSON = new CompressedJSON(makeDate, makeTime, makeDateTime);
    }

    private makeGraph = (): TypeGraph => {
        const stringTypeMapping = getTargetLanguage(this._options.lang).stringTypeMapping;
        const typeBuilder = new TypeGraphBuilder(stringTypeMapping);

        // JSON Schema
        Map(this._allInputs.schemas).forEach((schema, name) => {
            typeBuilder.addTopLevel(name, schemaToType(typeBuilder, name, schema));
        });

        // GraphQL
        const numInputs = Object.keys(this._allInputs.graphQLs).length;
        Map(this._allInputs.graphQLs).forEach(({ schema, query }, name) => {
            const newTopLevels = makeGraphQLQueryTypes(name, typeBuilder, schema, query);
            newTopLevels.forEach((t, actualName) => {
                typeBuilder.addTopLevel(numInputs === 1 ? name : actualName, t);
            });
        });

        // JSON
        const doInferEnums = this._options.inferEnums;
        if (Object.keys(this._allInputs.samples).length > 0) {
            const inference = new TypeInference(typeBuilder, doInferEnums);

            Map(this._allInputs.samples).forEach((cjson, name) => {
                typeBuilder.addTopLevel(
                    name,
                    inference.inferType(this._compressedJSON as CompressedJSON, makeTypeNames(name, false), cjson)
                );
            });
        }

        const originalGraph = typeBuilder.finish();
        let graph = originalGraph;
        const doCombineClasses = this._options.combineClasses;
        if (doCombineClasses) {
            graph = combineClasses(graph, stringTypeMapping);
        }
        if (doInferEnums) {
            graph = inferEnums(graph, stringTypeMapping);
        }
        const doInferMaps = this._options.inferMaps;
        if (doInferMaps) {
            graph = inferMaps(graph, stringTypeMapping);
        }
        graph = noneToAny(graph, stringTypeMapping);
        if (Object.keys(this._allInputs.schemas).length > 0 && graph === originalGraph) {
            // JSON Schema input can leave unreachable classes in the graph when it
            // unifies, which can trip is up, so we remove them here.
            graph = graph.garbageCollect();
        }

        gatherNames(graph);

        return graph;
    };

    public run = async (): Promise<SerializedRenderResult> => {
        const targetLanguage = getTargetLanguage(this._options.lang);

        for (const source of this._options.sources) {
            if (isGraphQLSource(source)) {
                const { name, schema, query } = source;
                this._allInputs.graphQLs[name] = { schema, query: await toString(query) };
            } else if (isJSONSource(source)) {
                const { name, samples } = source;
                for (const sample of samples) {
                    const input = await this._compressedJSON.readFromStream(toReadable(sample));
                    if (!_.has(this._allInputs.samples, name)) {
                        this._allInputs.samples[name] = [];
                    }
                    this._allInputs.samples[name].push(input);
                }
            } else if (isSchemaSource(source)) {
                const { name, schema } = source;
                const input = JSON.parse(await toString(schema));
                if (_.has(this._allInputs.schemas, name)) {
                    throw new Error(`More than one schema given for ${name}`);
                }
                this._allInputs.schemas[name] = input;
            } else {
                assertNever(source);
            }
        }

        const graph = this.makeGraph();

        if (this._options.noRender) {
            return { lines: ["Done.", ""], annotations: List() };
        }

        return targetLanguage.renderGraphAndSerialize(
            graph,
            this._options.alphabetizeProperties,
            this._options.leadingComments,
            this._options.rendererOptions,
            this._options.indentation
        );
    };
}

export function quicktype(options: Partial<Options>) {
    return new Run(options).run();
}
