import * as _ from "lodash";
import { List, Map, OrderedMap, OrderedSet } from "immutable";
import * as URI from "urijs";

import * as targetLanguages from "./Language/All";
import { TargetLanguage } from "./TargetLanguage";
import { SerializedRenderResult, Annotation, Location, Span } from "./Source";
import { assert, panic, defined, forEachSync } from "./Support";
import { CompressedJSON } from "./CompressedJSON";
import { combineClasses, findSimilarityCliques } from "./CombineClasses";
import { addTypesInSchema, Ref, definitionRefsInSchema } from "./JSONSchemaInput";
import { JSONSchemaStore } from "./JSONSchemaStore";
import { TypeInference } from "./Inference";
import { inferMaps } from "./InferMaps";
import { TypeBuilder } from "./TypeBuilder";
import { TypeGraph, noneToAny, optionalToNullable } from "./TypeGraph";
import { makeNamesTypeAttributes } from "./TypeNames";
import { makeGraphQLQueryTypes } from "./GraphQL";
import { gatherNames } from "./GatherNames";
import { inferEnums, flattenStrings } from "./InferEnums";
import { descriptionTypeAttributeKind } from "./TypeAttributes";
import { flattenUnions } from "./FlattenUnions";
import { resolveIntersections } from "./ResolveIntersections";
import { replaceObjectType } from "./ReplaceObjectType";
import { ErrorMessage, messageAssert, messageError } from "./Messages";
import { InputJSONSchemaStore, StringInput, TypeSource, InputData, SchemaTypeSource, toSchemaSource, toString } from "./Inputs";

// Re-export essential types and functions
export { TargetLanguage } from "./TargetLanguage";
export { SerializedRenderResult, Annotation } from "./Source";
export { all as languages, languageNamed } from "./Language/All";
export { OptionDefinition } from "./RendererOptions";

export function getTargetLanguage(nameOrInstance: string | TargetLanguage): TargetLanguage {
    if (typeof nameOrInstance === "object") {
        return nameOrInstance;
    }
    const language = targetLanguages.languageNamed(nameOrInstance);
    if (language !== undefined) {
        return language;
    }
    return messageError(ErrorMessage.UnknownOutputLanguage, { lang: nameOrInstance });
}

export type RendererOptions = { [name: string]: string };

export interface Options {
    lang: string | TargetLanguage;
    sources: TypeSource[];
    handlebarsTemplate: string | undefined;
    findSimilarClassesSchemaURI: string | undefined;
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
    schemaStore: JSONSchemaStore | undefined;
    debugPrintGraph: boolean;
    checkProvenance: boolean;
}

const defaultOptions: Options = {
    lang: "ts",
    sources: [],
    handlebarsTemplate: undefined,
    findSimilarClassesSchemaURI: undefined,
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
    outputFilename: "stdout",
    schemaStore: undefined,
    debugPrintGraph: false,
    checkProvenance: false
};

function nameFromURI(uri: uri.URI): string {
    // FIXME: Try `title` first.
    const fragment = uri.fragment();
    if (fragment !== "") {
        const components = fragment.split("/");
        const len = components.length;
        if (components[len - 1] !== "") {
            return components[len - 1];
        }
        if (len > 1 && components[len - 2] !== "") {
            return components[len - 2];
        }
    }
    const filename = uri.filename();
    if (filename !== "") {
        return filename;
    }
    return messageError(ErrorMessage.CannotInferNameForSchema, { uri: uri.toString() });
}

export class Run {
    private readonly _allInputs: InputData;
    private readonly _options: Options;
    private _schemaStore: JSONSchemaStore | undefined;
    private readonly _compressedJSON: CompressedJSON;

    constructor(options: Partial<Options>) {
        this._options = _.mergeWith(_.clone(options), defaultOptions, (o, s) => (o === undefined ? s : o));

        const mapping = getTargetLanguage(this._options.lang).stringTypeMapping;
        const makeDate = mapping.date !== "string";
        const makeTime = mapping.time !== "string";
        const makeDateTime = mapping.dateTime !== "string";

        this._compressedJSON = new CompressedJSON(makeDate, makeTime, makeDateTime);
        this._allInputs = new InputData(this._compressedJSON);
    }

    private getSchemaStore(): JSONSchemaStore {
        return defined(this._schemaStore);
    }

    private async makeGraph(): Promise<TypeGraph> {
        const targetLanguage = getTargetLanguage(this._options.lang);
        const stringTypeMapping = targetLanguage.stringTypeMapping;
        const conflateNumbers = !targetLanguage.supportsUnionsWithBothNumberTypes;
        const typeBuilder = new TypeBuilder(
            stringTypeMapping,
            this._options.alphabetizeProperties,
            this._options.allPropertiesOptional,
            this._options.checkProvenance,
            false
        );

        // JSON Schema
        let schemaInputs = this._allInputs.schemaInputs;
        if (this._options.findSimilarClassesSchemaURI !== undefined) {
            schemaInputs = schemaInputs.set("ComparisonBaseRoot", Ref.parse(this._options.findSimilarClassesSchemaURI));
        }
        if (!schemaInputs.isEmpty()) {
            await addTypesInSchema(typeBuilder, this.getSchemaStore(), schemaInputs);
        }

        // GraphQL
        const graphQLInputs = this._allInputs.graphQLInputs;
        graphQLInputs.forEach(({ schema, query }, name) => {
            const newTopLevels = makeGraphQLQueryTypes(name, typeBuilder, schema, query);
            newTopLevels.forEach((t, actualName) => {
                typeBuilder.addTopLevel(graphQLInputs.size === 1 ? name : actualName, t);
            });
        });

        // JSON
        const doInferEnums = this._options.inferEnums;
        const jsonInputs = this._allInputs.jsonInputs;
        if (!jsonInputs.isEmpty()) {
            const inference = new TypeInference(typeBuilder, doInferEnums, this._options.inferDates);

            jsonInputs.forEach(({ samples, description }, name) => {
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
        if (this._options.debugPrintGraph) {
            graph.setPrintOnRewrite();
            graph.printGraph();
        }

        let unionsDone = false;
        if (!schemaInputs.isEmpty()) {
            let intersectionsDone = false;
            do {
                const graphBeforeRewrites = graph;
                if (!intersectionsDone) {
                    [graph, intersectionsDone] = resolveIntersections(graph, stringTypeMapping);
                }
                if (!unionsDone) {
                    [graph, unionsDone] = flattenUnions(graph, stringTypeMapping, conflateNumbers, true);
                }

                if (graph === graphBeforeRewrites) {
                    assert(intersectionsDone && unionsDone, "Graph didn't change but we're not done");
                }
            } while (!intersectionsDone || !unionsDone);
        }

        graph = replaceObjectType(graph, stringTypeMapping, conflateNumbers, targetLanguage.supportsFullObjectType);
        do {
            [graph, unionsDone] = flattenUnions(graph, stringTypeMapping, conflateNumbers, false);
        } while (!unionsDone);

        if (this._options.findSimilarClassesSchemaURI !== undefined) {
            return graph;
        }

        if (this._options.combineClasses) {
            graph = combineClasses(graph, stringTypeMapping, this._options.alphabetizeProperties, conflateNumbers);
        }
        if (doInferEnums) {
            graph = inferEnums(graph, stringTypeMapping);
        }
        graph = flattenStrings(graph, stringTypeMapping);
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
        if (this._options.debugPrintGraph) {
            console.log("\n# gather names");
            graph.printGraph();
        }

        return graph;
    }

    private makeSimpleTextResult(lines: string[]): OrderedMap<string, SerializedRenderResult> {
        return OrderedMap([[this._options.outputFilename, { lines, annotations: List() }]] as [
            string,
            SerializedRenderResult
        ][]);
    }

    public run = async (): Promise<OrderedMap<string, SerializedRenderResult>> => {
        const targetLanguage = getTargetLanguage(this._options.lang);

        let schemaInputs: Map<string, StringInput> = Map();
        let schemaSources: List<[uri.URI, SchemaTypeSource]> = List();
        let needIR =
            targetLanguage.names.indexOf("schema") < 0 ||
            this._options.findSimilarClassesSchemaURI !== undefined ||
            this._options.handlebarsTemplate !== undefined;
        for (const source of this._options.sources) {
            const schemaSource = toSchemaSource(source);

            if (schemaSource === undefined) continue;

            needIR = schemaSource.isDirectInput || needIR;

            const { uri, schema } = schemaSource;

            let normalizedURI: uri.URI;
            if (uri === undefined) {
                normalizedURI = new URI(`-${schemaInputs.size + 1}`);
            } else {
                normalizedURI = new URI(uri).normalize();
            }

            if (schema === undefined) {
                assert(uri !== undefined, "URI must be given if schema source is not specified");
            } else {
                schemaInputs = schemaInputs.set(
                    normalizedURI
                        .clone()
                        .hash("")
                        .toString(),
                    schema
                );
            }

            schemaSources = schemaSources.push([normalizedURI, schemaSource]);
        }

        for (const source of this._options.sources) {
            needIR = await this._allInputs.addTypeSource(source) || needIR;
        }

        if (!needIR && schemaSources.size === 1) {
            const source = defined(schemaSources.first());
            const schemaString = await toString(defined(source[1].schema));
            const lines = JSON.stringify(JSON.parse(schemaString), undefined, 4).split("\n");
            lines.push("");
            const srr = { lines, annotations: List() };
            return OrderedMap([[this._options.outputFilename, srr] as [string, SerializedRenderResult]]);
        }

        if (!schemaSources.isEmpty()) {
            if (schemaInputs.isEmpty()) {
                if (this._options.schemaStore === undefined) {
                    return panic("Must have a schema store to process JSON Schema");
                }
                this._schemaStore = this._options.schemaStore;
            } else {
                this._schemaStore = new InputJSONSchemaStore(schemaInputs, this._options.schemaStore);
            }

            await forEachSync(schemaSources, async ([normalizedURI, source]) => {
                const { name, topLevelRefs } = source;
                const uriString = normalizedURI.toString();

                if (topLevelRefs !== undefined) {
                    messageAssert(
                        topLevelRefs.length === 1 && topLevelRefs[0] === "/definitions/",
                        ErrorMessage.InvalidSchemaTopLevelRefs,
                        { actual: topLevelRefs }
                    );
                    const definitionRefs = await definitionRefsInSchema(this.getSchemaStore(), uriString);
                    definitionRefs.forEach((ref, refName) => {
                        this._allInputs.addSchemaInput(refName, ref);
                    });
                } else {
                    const nameForSource = schemaSources.size === 1 ? name : nameFromURI(normalizedURI);
                    this._allInputs.addSchemaInput(nameForSource, Ref.parse(uriString));
                }
            });
        }

        const graph = await this.makeGraph();

        if (this._options.noRender) {
            return this.makeSimpleTextResult(["Done.", ""]);
        }

        if (this._options.findSimilarClassesSchemaURI !== undefined) {
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

export async function quicktypeMultiFile(options: Partial<Options>): Promise<Map<string, SerializedRenderResult>> {
    return await new Run(options).run();
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
