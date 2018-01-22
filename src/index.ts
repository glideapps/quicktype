import { getStream } from "./get-stream";
import * as _ from "lodash";
import { List, Map, OrderedMap } from "immutable";
import { Readable } from "stream";

import * as targetLanguages from "./Language/All";
import { TargetLanguage } from "./TargetLanguage";
import { SerializedRenderResult, Annotation, Location, Span } from "./Source";
import { assertNever } from "./Support";
import { CompressedJSON, Value } from "./CompressedJSON";
import { combineClasses } from "./CombineClasses";
import { schemaToType } from "./JSONSchemaInput";
import { TypeInference } from "./Inference";
import { inferMaps } from "./InferMaps";
import { TypeGraphBuilder } from "./TypeBuilder";
import { TypeGraph, noneToAny, optionalToNullable } from "./TypeGraph";
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
    if (language !== undefined) {
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
    handlebarsTemplate: string | undefined;
    inferMaps: boolean;
    inferEnums: boolean;
    alphabetizeProperties: boolean;
    combineClasses: boolean;
    noRender: boolean;
    leadingComments: string[] | undefined;
    rendererOptions: RendererOptions;
    indentation: string | undefined;
    outputFilename: string;
}

const defaultOptions: Options = {
    lang: "ts",
    sources: [],
    handlebarsTemplate: undefined,
    inferMaps: true,
    inferEnums: true,
    alphabetizeProperties: false,
    combineClasses: true,
    noRender: false,
    leadingComments: undefined,
    rendererOptions: {},
    indentation: undefined,
    outputFilename: "stdout"
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
        const targetLanguage = getTargetLanguage(this._options.lang);
        const stringTypeMapping = targetLanguage.stringTypeMapping;
        const typeBuilder = new TypeGraphBuilder(stringTypeMapping, this._options.alphabetizeProperties);

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
        if (this._options.combineClasses) {
            graph = combineClasses(graph, stringTypeMapping, this._options.alphabetizeProperties);
        }
        if (doInferEnums) {
            graph = inferEnums(graph, stringTypeMapping);
        }
        if (this._options.inferMaps) {
            graph = inferMaps(graph, stringTypeMapping);
        }
        graph = noneToAny(graph, stringTypeMapping);
        if (!targetLanguage.supportsOptionalClassProperties) {
            graph = optionalToNullable(graph, stringTypeMapping);
        }
        // JSON Schema input can leave unreachable classes in the graph when it
        // unifies, which can trip is up, so we remove them here.  Also, sometimes
        // we combine classes in ways that will the order come out differently
        // compared to what it would be from the equivalent schema, so we always
        // just garbage collect to get a defined order and be done with it.
        // FIXME: We don't actually have to do this if any of the above graph
        // rewrites did anything.  We could just check whether the current graph
        // is different from the one we started out with.
        graph = graph.garbageCollect();

        gatherNames(graph);

        return graph;
    };

    public run = async (): Promise<OrderedMap<string, SerializedRenderResult>> => {
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
            return OrderedMap([[this._options.outputFilename, { lines: ["Done.", ""], annotations: List() }]] as [
                string,
                SerializedRenderResult
            ][]);
        }

        if (this._options.handlebarsTemplate !== undefined) {
            return OrderedMap([
                [
                    this._options.outputFilename,
                    targetLanguage.processHandlebarsTemplate(
                        graph,
                        this._options.rendererOptions,
                        this._options.handlebarsTemplate
                    )
                ]
            ] as [string, SerializedRenderResult][]);
        } else {
            return targetLanguage.renderGraphAndSerialize(
                graph,
                this._options.outputFilename,
                this._options.alphabetizeProperties,
                this._options.leadingComments,
                this._options.rendererOptions,
                this._options.indentation
            );
        }
    };
}

export function quicktypeMultiFile(options: Partial<Options>): Promise<Map<string, SerializedRenderResult>> {
    return new Run(options).run();
}

function offsetLocation(loc: Location, lineOffset: number): Location {
    return { line: loc.line + lineOffset, column: loc.column };
}

function offsetSpan(span: Span, lineOffset: number): Span {
    return { start: offsetLocation(span.start, lineOffset), end: offsetLocation(span.end, lineOffset) };
}

export async function quicktype(options: Partial<Options>): Promise<SerializedRenderResult> {
    const result = await quicktypeMultiFile(options);
    if (result.size <= 1) {
        const first = result.first();
        if (first === undefined) {
            return { lines: [], annotations: List<Annotation>() };
        }
        return first;
    }
    let lines: string[] = [];
    let annotations: Annotation[] = [];
    result.forEach((srr, filename) => {
        const offset = lines.length + 2;
        lines = lines.concat([`// ${filename}`, ""], srr.lines);
        annotations = annotations.concat(
            srr.annotations.map(ann => ({ annotation: ann.annotation, span: offsetSpan(ann.span, offset) })).toArray()
        );
    });
    return { lines, annotations: List(annotations) };
}
