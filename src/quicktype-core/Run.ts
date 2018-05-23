import * as targetLanguages from "./language/All";
import { TargetLanguage } from "./TargetLanguage";
import { SerializedRenderResult, Annotation, Location, Span } from "./Source";
import { assert } from "./support/Support";
import { combineClasses } from "./rewrites/CombineClasses";
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
import { InputData } from "./input/Inputs";
import { flattenStrings } from "./rewrites/FlattenStrings";
import { makeTransformations } from "./MakeTransformations";
import { mapFirst } from "./support/Containers";

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

/** The options for main quicktype entry points */
export interface Options {
    /**
     * The target language for which to produce code.  This can be either an instance of `TargetLanguage`,
     * or a string specifying one of the names for quicktype's built-in target languages.  For example,
     * both `cs` and `csharp` will generate C#.
     */
    lang: string | TargetLanguage;
    /** The input data from which to produce types */
    inputData: InputData;
    /** Whether to infer map types from JSON data */
    inferMaps: boolean;
    /** Whether to infer enum types from JSON data */
    inferEnums: boolean;
    /** Whether to assume that JSON strings that look like dates are dates */
    inferDates: boolean;
    /** Put class properties in alphabetical order, instead of in the order found in the JSON */
    alphabetizeProperties: boolean;
    /** Make all class property optional */
    allPropertiesOptional: boolean;
    /** Combine similar classes.  This doesn't apply to classes from a schema, only from inference. */
    combineClasses: boolean;
    /**
     * Make top-levels classes from JSON fixed.  That means even if two top-level classes are exactly
     * the same, quicktype will still generate two separate types for them.
     */
    fixedTopLevels: boolean;
    /** Don't render output.  This is mainly useful for benchmarking. */
    noRender: boolean;
    /** If given, output these comments at the beginning of the main output file */
    leadingComments: string[] | undefined;
    /** Options for the target language's renderer */
    rendererOptions: RendererOptions;
    /** String to use for one indentation level.  If not given, use the target language's default. */
    indentation: string | undefined;
    /** Name of the output file.  Note that quicktype will not write that file, but you'll get its name
     * back as a key in the resulting `Map`.
     */
    outputFilename: string;
    /** Print the type graph to the console at every processing step */
    debugPrintGraph: boolean;
    /** Check that we're propagating all type attributes (unless we actually can't) */
    checkProvenance: boolean;
    /**
     * Print type reconstitution debug information to the console.  You'll only ever need this if
     * you're working deep inside quicktype-core.
     */
    debugPrintReconstitution: boolean;
    /**
     * Print name gathering debug information to the console.  This might help to figure out why
     * your types get weird names, but the output is quite arcane.
     */
    debugPrintGatherNames: boolean;
    /** Print all transformations to the console prior to generating code */
    debugPrintTransformations: boolean;
}

const defaultOptions: Options = {
    lang: "ts",
    inputData: new InputData(),
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
    debugPrintGraph: false,
    checkProvenance: false,
    debugPrintReconstitution: false,
    debugPrintGatherNames: false,
    debugPrintTransformations: false
};

class Run {
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

    private makeSimpleTextResult(lines: string[]): ReadonlyMap<string, SerializedRenderResult> {
        return new Map([[this._options.outputFilename, { lines, annotations: [] }]] as [
            string,
            SerializedRenderResult
        ][]);
    }

    public async run(): Promise<ReadonlyMap<string, SerializedRenderResult>> {
        // FIXME: This makes quicktype not quite reentrant
        initTypeNames();

        const targetLanguage = getTargetLanguage(this._options.lang);
        const inputData = this._options.inputData;

        await inputData.finishAddingInputs();

        const needIR = inputData.needIR || targetLanguage.names.indexOf("schema") < 0;

        const schemaString = needIR ? undefined : inputData.singleStringSchemaSource();
        if (schemaString !== undefined) {
            const lines = JSON.stringify(JSON.parse(schemaString), undefined, 4).split("\n");
            lines.push("");
            const srr = { lines, annotations: [] };
            return new Map([[this._options.outputFilename, srr] as [string, SerializedRenderResult]]);
        }

        const graph = await this.makeGraph(inputData);

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

export async function quicktypeMultiFile(
    options: Partial<Options>
): Promise<ReadonlyMap<string, SerializedRenderResult>> {
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
        const first = mapFirst(result);
        if (first === undefined) {
            return { lines: [], annotations: [] };
        }
        return first;
    }
    let lines: string[] = [];
    let annotations: Annotation[] = [];
    for (const [filename, srr] of result) {
        const offset = lines.length + 2;
        lines = lines.concat([`// ${filename}`, ""], srr.lines);
        annotations = annotations.concat(
            srr.annotations.map(ann => ({ annotation: ann.annotation, span: offsetSpan(ann.span, offset) }))
        );
    }
    return { lines, annotations };
}
