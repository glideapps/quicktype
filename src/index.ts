import { getStream } from "./get-stream";
import * as _ from "lodash";
import { List, Map, OrderedMap, OrderedSet } from "immutable";
import { Readable } from "stream";

import * as targetLanguages from "./Language/All";
import { TargetLanguage } from "./TargetLanguage";
import { SerializedRenderResult, Annotation, Location, Span } from "./Source";
import { assertNever, assert } from "./Support";
import { CompressedJSON, Value } from "./CompressedJSON";
import { combineClasses, findSimilarityCliques } from "./CombineClasses";
import { addTypesInSchema, definitionRefsInSchema, Ref, JSONSchema, JSONSchemaStore, checkJSONSchema } from "./JSONSchemaInput";
import { TypeInference } from "./Inference";
import { inferMaps } from "./InferMaps";
import { TypeGraphBuilder } from "./TypeBuilder";
import { TypeGraph, noneToAny, optionalToNullable } from "./TypeGraph";
import { makeNamesTypeAttributes } from "./TypeNames";
import { makeGraphQLQueryTypes } from "./GraphQL";
import { gatherNames } from "./GatherNames";
import { inferEnums } from "./InferEnums";
import { descriptionTypeAttributeKind } from "./TypeAttributes";
import { flattenUnions } from "./FlattenUnions";
import { resolveIntersections } from "./ResolveIntersections";

// Re-export essential types and functions
export { TargetLanguage } from "./TargetLanguage";
export { SerializedRenderResult, Annotation } from "./Source";
export { all as languages, languageNamed } from "./Language/All";
export { OptionDefinition } from "./RendererOptions";

const stringToStream = require("string-to-stream");

export function getTargetLanguage(nameOrInstance: string | TargetLanguage): TargetLanguage {
    if (typeof nameOrInstance === "object") {
        return nameOrInstance;
    }
    const language = targetLanguages.languageNamed(nameOrInstance);
    if (language !== undefined) {
        return language;
    }
    throw new Error(`'${nameOrInstance}' is not yet supported as an output language.`);
}

export type RendererOptions = { [name: string]: string };

export type StringInput = string | Readable;

export interface JSONTypeSource {
    name: string;
    samples: StringInput[];
    description?: string;
}

export function isJSONSource(source: TypeSource): source is JSONTypeSource {
    return "samples" in source;
}

export interface SchemaTypeSource {
    name: string;
    schema: StringInput;
    topLevelRefs?: string[];
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
    lang: string | TargetLanguage;
    sources: TypeSource[];
    handlebarsTemplate: string | undefined;
    findSimilarClassesSchema: string | undefined;
    inferMaps: boolean;
    inferEnums: boolean;
    inferDates: boolean;
    alphabetizeProperties: boolean;
    allPropertiesOptional: boolean;
    combineClasses: boolean;
    fixedTopLevels: boolean;
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
    findSimilarClassesSchema: undefined,
    inferMaps: true,
    inferEnums: true,
    inferDates: true,
    alphabetizeProperties: false,
    allPropertiesOptional: false,
    combineClasses: true,
    fixedTopLevels: false,
    noRender: false,
    leadingComments: undefined,
    rendererOptions: {},
    indentation: undefined,
    outputFilename: "stdout"
};

type InputData = {
    samples: { [name: string]: { samples: Value[]; description?: string } };
    schemas: { [name: string]: { schema: any; topLevelRefs: string[] | undefined } };
    graphQLs: { [name: string]: { schema: any; query: string } };
};

function toReadable(source: string | Readable): Readable {
    return _.isString(source) ? stringToStream(source) : source;
}

async function toString(source: string | Readable): Promise<string> {
    return _.isString(source) ? source : await getStream(source);
}

class SimpleJSONSchemaStore extends JSONSchemaStore {
    constructor (private readonly _name: string, private readonly _schema: JSONSchema) {
        super();
    }

    protected fetch(address: string): JSONSchema | undefined {
        assert(address === this._name, `Wrong address ${address}`);
        return this._schema;
    }
}

export class Run {
    private _compressedJSON: CompressedJSON;
    private _allInputs: InputData;
    private _options: Options;

    constructor(options: Partial<Options>) {
        this._options = _.mergeWith(_.clone(options), defaultOptions, (o, s) => (o === undefined ? s : o));
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
        const conflateNumbers = !targetLanguage.supportsUnionsWithBothNumberTypes;
        const haveSchemas = Object.getOwnPropertyNames(this._allInputs.schemas).length > 0;
        const typeBuilder = new TypeGraphBuilder(
            stringTypeMapping,
            this._options.alphabetizeProperties,
            this._options.allPropertiesOptional,
            haveSchemas,
            false
        );

        if (this._options.findSimilarClassesSchema !== undefined) {
            const schema = checkJSONSchema(JSON.parse(this._options.findSimilarClassesSchema));
            const name = "ComparisonBaseRoot";
            const store = new SimpleJSONSchemaStore(name, schema);
            addTypesInSchema(typeBuilder, store, Map([[name, Ref.root(name)] as [string, Ref]]));
        }

        // JSON Schema
        Map(this._allInputs.schemas).forEach(({ schema, topLevelRefs }, name) => {
            let references: Map<string, Ref>;
            if (topLevelRefs === undefined) {
                references = Map([[name, Ref.root(name)] as [string, Ref]]);
            } else {
                assert(
                    topLevelRefs.length === 1 && topLevelRefs[0] === "definitions/",
                    "Schema top level refs must be `definitions/`"
                );
                references = definitionRefsInSchema(schema, name);
                assert(references.size > 0, "No definitions in JSON Schema");
            }
            const store = new SimpleJSONSchemaStore(name, checkJSONSchema(schema));
            addTypesInSchema(typeBuilder, store, references);
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
        const numSamples = Object.keys(this._allInputs.samples).length;
        if (numSamples > 0) {
            const inference = new TypeInference(typeBuilder, doInferEnums, this._options.inferDates);

            Map(this._allInputs.samples).forEach(({ samples, description }, name) => {
                const tref = inference.inferType(
                    this._compressedJSON as CompressedJSON,
                    makeNamesTypeAttributes(name, false),
                    samples,
                    this._options.fixedTopLevels
                );
                typeBuilder.addTopLevel(name, tref);
                if (description !== undefined) {
                    const attributes = descriptionTypeAttributeKind.makeAttributes(OrderedSet([description]));
                    typeBuilder.addAttributes(tref, attributes);
                }
            });
        }

        let graph = typeBuilder.finish();

        if (haveSchemas) {
            let intersectionsDone = false;
            let unionsDone = false;
            do {
                const graphBeforeRewrites = graph;
                if (!intersectionsDone) {
                    [graph, intersectionsDone] = resolveIntersections(graph, stringTypeMapping);
                }
                if (!unionsDone) {
                    [graph, unionsDone] = flattenUnions(graph, stringTypeMapping, conflateNumbers);
                }

                if (graph === graphBeforeRewrites) {
                    assert(intersectionsDone && unionsDone, "Graph didn't change but we're not done");
                }
            } while (!intersectionsDone || !unionsDone);
        }

        if (this._options.findSimilarClassesSchema !== undefined) {
            return graph;
        }

        if (this._options.combineClasses) {
            graph = combineClasses(graph, stringTypeMapping, this._options.alphabetizeProperties, conflateNumbers);
        }
        if (doInferEnums) {
            graph = inferEnums(graph, stringTypeMapping);
        }
        if (this._options.inferMaps) {
            graph = inferMaps(graph, stringTypeMapping, conflateNumbers);
        }
        graph = noneToAny(graph, stringTypeMapping);
        if (!targetLanguage.supportsOptionalClassProperties) {
            graph = optionalToNullable(graph, stringTypeMapping);
        }
        // Sometimes we combine classes in ways that will the order come out
        // differently compared to what it would be from the equivalent schema,
        // so we always just garbage collect to get a defined order and be done
        // with it.
        // FIXME: We don't actually have to do this if any of the above graph
        // rewrites did anything.  We could just check whether the current graph
        // is different from the one we started out with.
        graph = graph.garbageCollect(this._options.alphabetizeProperties);

        gatherNames(graph);

        // graph.printGraph();

        return graph;
    };

    private makeSimpleTextResult(lines: string[]): OrderedMap<string, SerializedRenderResult> {
        return OrderedMap([[this._options.outputFilename, { lines, annotations: List() }]] as [
            string,
            SerializedRenderResult
        ][]);
    }

    public run = async (): Promise<OrderedMap<string, SerializedRenderResult>> => {
        const targetLanguage = getTargetLanguage(this._options.lang);

        for (const source of this._options.sources) {
            if (isGraphQLSource(source)) {
                const { name, schema, query } = source;
                this._allInputs.graphQLs[name] = { schema, query: await toString(query) };
            } else if (isJSONSource(source)) {
                const { name, samples, description } = source;
                for (const sample of samples) {
                    const input = await this._compressedJSON.readFromStream(toReadable(sample));
                    if (!_.has(this._allInputs.samples, name)) {
                        this._allInputs.samples[name] = { samples: [] };
                    }
                    this._allInputs.samples[name].samples.push(input);
                    if (description !== undefined) {
                        this._allInputs.samples[name].description = description;
                    }
                }
            } else if (isSchemaSource(source)) {
                const { name, schema, topLevelRefs } = source;
                const input = JSON.parse(await toString(schema));
                if (_.has(this._allInputs.schemas, name)) {
                    throw new Error(`More than one schema given for ${name}`);
                }
                this._allInputs.schemas[name] = { schema: input, topLevelRefs };
            } else {
                assertNever(source);
            }
        }

        const graph = this.makeGraph();

        if (this._options.noRender) {
            return this.makeSimpleTextResult(["Done.", ""]);
        }

        if (this._options.findSimilarClassesSchema !== undefined) {
            const cliques = findSimilarityCliques(graph, true);
            const lines: string[] = [];
            if (cliques.length === 0) {
                lines.push("No similar classes found.");
            } else {
                for (let clique of cliques) {
                    lines.push(`similar: ${clique.map(c => c.getCombinedName()).join(", ")}`);
                }
            }
            lines.push("");
            return this.makeSimpleTextResult(lines);
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
