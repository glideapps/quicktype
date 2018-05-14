import { List, Map, OrderedMap } from "immutable";

import * as targetLanguages from "./language/All";
import { TargetLanguage } from "./TargetLanguage";
import { SerializedRenderResult, Annotation, Location, Span } from "./Source";
import { assert } from "./support/Support";
import { CompressedJSON } from "./input/CompressedJSON";
import { combineClasses } from "./rewrites/CombineClasses";
import { JSONSchemaStore } from "./input/JSONSchemaStore";
import { inferMaps } from "./rewrites/InferMaps";
import { TypeBuilder } from "./TypeBuilder";
import { TypeGraph, noneToAny, optionalToNullable, removeIndirectionIntersections } from "./TypeGraph";
import { initTypeNames } from "./TypeNames";
import { gatherNames } from "./GatherNames";
import { expandStrings } from "./rewrites/ExpandStrings";
import { flattenUnions } from "./rewrites/FlattenUnions";
import { resolveIntersections } from "./rewrites/ResolveIntersections";
import { replaceObjectType } from "./rewrites/ReplaceObjectType";
import { messageError } from "./Messages";
import { InputData, JSONSchemaSources } from "./input/Inputs";
import { TypeSource } from "./TypeSource";
import { flattenStrings } from "./rewrites/FlattenStrings";
import { makeTransformations } from "./MakeTransformations";

// Re-export essential types and functions
export { TargetLanguage } from "./TargetLanguage";
export { SerializedRenderResult, Annotation } from "./Source";
export { all as languages, languageNamed } from "./language/All";
export { OptionDefinition } from "./RendererOptions";
export { TypeSource, GraphQLTypeSource, JSONTypeSource, SchemaTypeSource } from "./TypeSource";

export function getTargetLanguage(nameOrInstance: string | TargetLanguage): TargetLanguage {
    if (typeof nameOrInstance === "object") {
        return nameOrInstance;
    }
    const language = targetLanguages.languageNamed(nameOrInstance);
    if (language !== undefined) {
        return language;
    }
    return messageError("DriverUnknownOutputLanguage", { lang: nameOrInstance });
}

export type RendererOptions = { [name: string]: string };

export interface Options {
    lang: string | TargetLanguage;
    sources: TypeSource[];
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
    debugPrintReconstitution: boolean;
    debugPrintGatherNames: boolean;
    debugPrintTransformations: boolean;
}

const defaultOptions: Options = {
    lang: "ts",
    sources: [],
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
    checkProvenance: false,
    debugPrintReconstitution: false,
    debugPrintGatherNames: false,
    debugPrintTransformations: false
};

export class Run {
    private readonly _options: Options;

    constructor(options: Partial<Options>) {
        this._options = Object.assign(Object.assign({}, defaultOptions), options);
    }

    private async makeGraph(allInputs: InputData): Promise<TypeGraph> {
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

        await allInputs.addTypes(
            typeBuilder,
            this._options.inferEnums,
            this._options.inferDates,
            this._options.fixedTopLevels
        );

        let graph = typeBuilder.finish();
        if (this._options.debugPrintGraph) {
            graph.setPrintOnRewrite();
            graph.printGraph();
        }

        const debugPrintReconstitution = this._options.debugPrintReconstitution === true;

        if (typeBuilder.didAddForwardingIntersection) {
            graph = removeIndirectionIntersections(graph, stringTypeMapping, debugPrintReconstitution);
        }

        let unionsDone = false;
        if (allInputs.needSchemaProcessing) {
            let intersectionsDone = false;
            do {
                const graphBeforeRewrites = graph;
                if (!intersectionsDone) {
                    [graph, intersectionsDone] = resolveIntersections(
                        graph,
                        stringTypeMapping,
                        debugPrintReconstitution
                    );
                }
                if (!unionsDone) {
                    [graph, unionsDone] = flattenUnions(
                        graph,
                        stringTypeMapping,
                        conflateNumbers,
                        true,
                        debugPrintReconstitution
                    );
                }

                if (graph === graphBeforeRewrites) {
                    assert(intersectionsDone && unionsDone, "Graph didn't change but we're not done");
                }
            } while (!intersectionsDone || !unionsDone);
        }

        graph = replaceObjectType(
            graph,
            stringTypeMapping,
            conflateNumbers,
            targetLanguage.supportsFullObjectType,
            debugPrintReconstitution
        );
        do {
            [graph, unionsDone] = flattenUnions(
                graph,
                stringTypeMapping,
                conflateNumbers,
                false,
                debugPrintReconstitution
            );
        } while (!unionsDone);

        if (this._options.combineClasses) {
            const combinedGraph = combineClasses(
                graph,
                stringTypeMapping,
                this._options.alphabetizeProperties,
                true,
                false,
                debugPrintReconstitution
            );
            if (combinedGraph === graph) {
                graph = combinedGraph;
            } else {
                graph = combineClasses(
                    combinedGraph,
                    stringTypeMapping,
                    this._options.alphabetizeProperties,
                    false,
                    true,
                    debugPrintReconstitution
                );
            }
        }

        if (this._options.inferMaps) {
            for (;;) {
                const newGraph = inferMaps(graph, stringTypeMapping, true, debugPrintReconstitution);
                if (newGraph === graph) {
                    break;
                }
                graph = newGraph;
            }
        }

        const enumInference = allInputs.needSchemaProcessing ? "all" : this._options.inferEnums ? "infer" : "none";
        graph = expandStrings(graph, stringTypeMapping, enumInference, debugPrintReconstitution);
        [graph, unionsDone] = flattenUnions(graph, stringTypeMapping, conflateNumbers, false, debugPrintReconstitution);
        assert(unionsDone, "We should only have to flatten unions once after expanding strings");

        if (allInputs.needSchemaProcessing) {
            graph = flattenStrings(graph, stringTypeMapping, debugPrintReconstitution);
        }

        graph = noneToAny(graph, stringTypeMapping, debugPrintReconstitution);
        if (!targetLanguage.supportsOptionalClassProperties) {
            graph = optionalToNullable(graph, stringTypeMapping, debugPrintReconstitution);
        }

        graph = makeTransformations(
            graph,
            stringTypeMapping,
            targetLanguage,
            this._options.debugPrintTransformations,
            debugPrintReconstitution
        );
        [graph, unionsDone] = flattenUnions(graph, stringTypeMapping, conflateNumbers, false, debugPrintReconstitution);
        assert(unionsDone, "We should only have to flatten unions once after making transformations");

        // Sometimes we combine classes in ways that will the order come out
        // differently compared to what it would be from the equivalent schema,
        // so we always just garbage collect to get a defined order and be done
        // with it.
        // FIXME: We don't actually have to do this if any of the above graph
        // rewrites did anything.  We could just check whether the current graph
        // is different from the one we started out with.
        graph = graph.garbageCollect(this._options.alphabetizeProperties, debugPrintReconstitution);

        if (this._options.debugPrintGraph) {
            console.log("\n# gather names");
        }
        gatherNames(graph, this._options.debugPrintGatherNames);
        if (this._options.debugPrintGraph) {
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

    public async run(): Promise<OrderedMap<string, SerializedRenderResult>> {
        initTypeNames();

        const targetLanguage = getTargetLanguage(this._options.lang);
        let needIR = targetLanguage.names.indexOf("schema") < 0;

        const mapping = targetLanguage.stringTypeMapping;
        const makeDate = mapping.date !== "string";
        const makeTime = mapping.time !== "string";
        const makeDateTime = mapping.dateTime !== "string";

        const compressedJSON = new CompressedJSON(makeDate, makeTime, makeDateTime);
        const jsonSchemaSources = new JSONSchemaSources(this._options.schemaStore);
        const allInputs = new InputData(compressedJSON);

        if (await allInputs.addTypeSources(this._options.sources, jsonSchemaSources)) {
            needIR = true;
        }

        const schemaString = needIR ? undefined : jsonSchemaSources.singleStringSchemaSource();
        if (schemaString !== undefined) {
            const lines = JSON.stringify(JSON.parse(schemaString), undefined, 4).split("\n");
            lines.push("");
            const srr = { lines, annotations: List() };
            return OrderedMap([[this._options.outputFilename, srr] as [string, SerializedRenderResult]]);
        }

        await jsonSchemaSources.addInputs(allInputs);

        const graph = await this.makeGraph(allInputs);

        if (this._options.noRender) {
            return this.makeSimpleTextResult(["Done.", ""]);
        }

        return targetLanguage.renderGraphAndSerialize(
            graph,
            this._options.outputFilename,
            this._options.alphabetizeProperties,
            this._options.leadingComments,
            this._options.rendererOptions,
            this._options.indentation
        );
    }
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
