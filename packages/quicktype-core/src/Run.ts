import { mapFirst } from "collection-utils";

import * as targetLanguages from "./language/All";
import { TargetLanguage, MultiFileRenderResult } from "./TargetLanguage";
import { SerializedRenderResult, Annotation, Location, Span } from "./Source";
import { assert } from "./support/Support";
import { combineClasses } from "./rewrites/CombineClasses";
import { inferMaps } from "./rewrites/InferMaps";
import { TypeBuilder, StringTypeMapping } from "./TypeBuilder";
import { TypeGraph, noneToAny, optionalToNullable, removeIndirectionIntersections } from "./TypeGraph";
import { initTypeNames } from "./attributes/TypeNames";
import { gatherNames } from "./GatherNames";
import { expandStrings } from "./rewrites/ExpandStrings";
import { flattenUnions } from "./rewrites/FlattenUnions";
import { resolveIntersections } from "./rewrites/ResolveIntersections";
import { replaceObjectType } from "./rewrites/ReplaceObjectType";
import { messageError } from "./Messages";
import { InputData } from "./input/Inputs";
import { flattenStrings } from "./rewrites/FlattenStrings";
import { makeTransformations } from "./MakeTransformations";
import { TransformedStringTypeKind } from "./Type";

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

export type RendererOptions = { [name: string]: string | boolean };

export interface InferenceFlag {
    description: string;
    negationDescription: string;
    explanation: string;
    order: number;
    stringType?: TransformedStringTypeKind;
}

export const inferenceFlagsObject = {
    /** Whether to infer map types from JSON data */
    inferMaps: {
        description: "Detect maps",
        negationDescription: "Don't infer maps, always use classes",
        explanation: "Infer maps when object keys look like map keys.",
        order: 1
    },
    /** Whether to infer enum types from JSON data */
    inferEnums: {
        description: "Detect enums",
        negationDescription: "Don't infer enums, always use strings",
        explanation: "If string values occur within a relatively small domain,\ninfer them as enum values.",
        order: 2
    },
    /** Whether to convert UUID strings to UUID objects */
    inferUuids: {
        description: "Detect UUIDs",
        negationDescription: "Don't convert UUIDs to UUID objects",
        explanation: "Detect UUIDs like '123e4567-e89b-12d3-a456-426655440000' (partial support).",
        stringType: "uuid" as TransformedStringTypeKind,
        order: 3
    },
    /** Whether to assume that JSON strings that look like dates are dates */
    inferDateTimes: {
        description: "Detect dates & times",
        negationDescription: "Don't infer dates or times",
        explanation: "Infer dates from strings (partial support).",
        stringType: "date-time" as TransformedStringTypeKind,
        order: 4
    },
    /** Whether to convert stringified integers to integers */
    inferIntegerStrings: {
        description: "Detect integers in strings",
        negationDescription: "Don't convert stringified integers to integers",
        explanation: 'Automatically convert stringified integers to integers.\nFor example, "1" is converted to 1.',
        stringType: "integer-string" as TransformedStringTypeKind,
        order: 5
    },
    /** Whether to convert stringified booleans to boolean values */
    inferBooleanStrings: {
        description: "Detect booleans in strings",
        negationDescription: "Don't convert stringified booleans to booleans",
        explanation:
            'Automatically convert stringified booleans to booleans.\nFor example, "true" is converted to true.',
        stringType: "bool-string" as TransformedStringTypeKind,
        order: 6
    },
    /** Combine similar classes.  This doesn't apply to classes from a schema, only from inference. */
    combineClasses: {
        description: "Merge similar classes",
        negationDescription: "Don't combine similar classes",
        explanation:
            "Combine classes with significantly overlapping properties,\ntreating contingent properties as nullable.",
        order: 7
    },
    /** Whether to treat $ref as references within JSON */
    ignoreJsonRefs: {
        description: "Don't treat $ref as a reference in JSON",
        negationDescription: "Treat $ref as a reference in JSON",
        explanation:
            "Like in JSON Schema, allow objects like\n'{ $ref: \"#/foo/bar\" }' to refer\nto another part of the input.",
        order: 8
    }
};
export type InferenceFlagName = keyof typeof inferenceFlagsObject;
export const inferenceFlagNames = Object.getOwnPropertyNames(inferenceFlagsObject) as InferenceFlagName[];
export const inferenceFlags: { [F in InferenceFlagName]: InferenceFlag } = inferenceFlagsObject;

export type InferenceFlags = { [F in InferenceFlagName]: boolean };

/**
 * The options type for the main quicktype entry points,
 * `quicktypeMultiFile` and `quicktype`.
 */
export type NonInferenceOptions = {
    /**
     * The target language for which to produce code.  This can be either an instance of `TargetLanguage`,
     * or a string specifying one of the names for quicktype's built-in target languages.  For example,
     * both `cs` and `csharp` will generate C#.
     */
    lang: string | TargetLanguage;
    /** The input data from which to produce types */
    inputData: InputData;
    /** Put class properties in alphabetical order, instead of in the order found in the JSON */
    alphabetizeProperties: boolean;
    /** Make all class property optional */
    allPropertiesOptional: boolean;
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
    /** Print the time it took for each pass to run */
    debugPrintTimes: boolean;
    /** Print schema resolving steps */
    debugPrintSchemaResolving: boolean;
    /** Will flatten union types */
    flattenUnions: boolean;
};

export type Options = NonInferenceOptions & InferenceFlags;

const defaultOptions: NonInferenceOptions = {
    lang: "ts",
    inputData: new InputData(),
    alphabetizeProperties: false,
    allPropertiesOptional: false,
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
    debugPrintTransformations: false,
    debugPrintTimes: false,
    debugPrintSchemaResolving: false,
    flattenUnions: false
};

export interface RunContext {
    stringTypeMapping: StringTypeMapping;
    debugPrintReconstitution: boolean;
    debugPrintTransformations: boolean;
    debugPrintSchemaResolving: boolean;

    timeSync<T>(name: string, f: () => Promise<T>): Promise<T>;
    time<T>(name: string, f: () => T): T;
}

interface GraphInputs {
    targetLanguage: TargetLanguage;
    stringTypeMapping: StringTypeMapping;
    conflateNumbers: boolean;
    flattenUnions: boolean;
    typeBuilder: TypeBuilder;
}

function makeDefaultInferenceFlags(): InferenceFlags {
    const flags = {} as InferenceFlags;
    for (const flag of inferenceFlagNames) {
        flags[flag] = true;
    }
    return flags;
}

export const defaultInferenceFlags = makeDefaultInferenceFlags();

class Run implements RunContext {
    private readonly _options: Options;

    constructor(options: Partial<Options>) {
        // We must not overwrite defaults with undefined values, which
        // we sometimes get.
        this._options = Object.assign({}, defaultOptions, defaultInferenceFlags);
        for (const k of Object.getOwnPropertyNames(options)) {
            const v = (options as any)[k];
            if (v !== undefined) {
                (this._options as any)[k] = v;
            }
        }
    }

    get stringTypeMapping(): StringTypeMapping {
        const targetLanguage = getTargetLanguage(this._options.lang);
        const mapping = new Map(targetLanguage.stringTypeMapping);
        for (const flag of inferenceFlagNames) {
            const stringType = inferenceFlags[flag].stringType;
            if (!this._options[flag] && stringType !== undefined) {
                mapping.set(stringType, "string");
            }
        }
        return mapping;
    }

    get debugPrintReconstitution(): boolean {
        return this._options.debugPrintReconstitution === true;
    }

    get debugPrintTransformations(): boolean {
        return this._options.debugPrintTransformations;
    }

    get debugPrintSchemaResolving(): boolean {
        return this._options.debugPrintSchemaResolving;
    }

    async timeSync<T>(name: string, f: () => Promise<T>): Promise<T> {
        const start = Date.now();
        const result = await f();
        const end = Date.now();
        if (this._options.debugPrintTimes) {
            console.log(`${name} took ${end - start}ms`);
        }
        return result;
    }

    time<T>(name: string, f: () => T): T {
        const start = Date.now();
        const result = f();
        const end = Date.now();
        if (this._options.debugPrintTimes) {
            console.log(`${name} took ${end - start}ms`);
        }
        return result;
    }

    private makeGraphInputs(): GraphInputs {
        const targetLanguage = getTargetLanguage(this._options.lang);
        const stringTypeMapping = this.stringTypeMapping;
        const conflateNumbers = !targetLanguage.supportsUnionsWithBothNumberTypes;
        const flattenUnions = this._options.flattenUnions;
        const typeBuilder = new TypeBuilder(
            0,
            stringTypeMapping,
            this._options.alphabetizeProperties,
            this._options.allPropertiesOptional,
            this._options.checkProvenance,
            false
        );

        return { targetLanguage, stringTypeMapping, conflateNumbers, flattenUnions, typeBuilder };
    }

    private async makeGraph(allInputs: InputData): Promise<TypeGraph> {
        const graphInputs = this.makeGraphInputs();

        await this.timeSync(
            "read input",
            async () =>
                await allInputs.addTypes(
                    this,
                    graphInputs.typeBuilder,
                    this._options.inferMaps,
                    this._options.inferEnums,
                    this._options.fixedTopLevels
                )
        );

        return this.processGraph(allInputs, graphInputs);
    }

    private makeGraphSync(allInputs: InputData): TypeGraph {
        const graphInputs = this.makeGraphInputs();

        this.time("read input", () =>
            allInputs.addTypesSync(
                this,
                graphInputs.typeBuilder,
                this._options.inferMaps,
                this._options.inferEnums,
                this._options.fixedTopLevels
            )
        );

        return this.processGraph(allInputs, graphInputs);
    }

    private processGraph(allInputs: InputData, graphInputs: GraphInputs): TypeGraph {
        const { targetLanguage, stringTypeMapping, conflateNumbers, flattenUnions: flattenUnionsFlag, typeBuilder } = graphInputs;

        let graph = typeBuilder.finish();
        if (this._options.debugPrintGraph) {
            graph.setPrintOnRewrite();
            graph.printGraph();
        }

        const debugPrintReconstitution = this.debugPrintReconstitution;

        if (typeBuilder.didAddForwardingIntersection || !this._options.ignoreJsonRefs) {
            this.time(
                "remove indirection intersections",
                () => (graph = removeIndirectionIntersections(graph, stringTypeMapping, debugPrintReconstitution))
            );
        }

        let unionsDone = false;
        if (allInputs.needSchemaProcessing || !this._options.ignoreJsonRefs) {
            let intersectionsDone = false;
            do {
                const graphBeforeRewrites = graph;
                if (!intersectionsDone) {
                    this.time(
                        "resolve intersections",
                        () =>
                            ([graph, intersectionsDone] = resolveIntersections(
                                graph,
                                stringTypeMapping,
                                debugPrintReconstitution
                            ))
                    );
                }
                if (!unionsDone) {
                    this.time(
                        "flatten unions",
                        () =>
                            ([graph, unionsDone] = flattenUnions(
                                graph,
                                stringTypeMapping,
                                conflateNumbers,
                                flattenUnionsFlag,
                                true,
                                debugPrintReconstitution
                            ))
                    );
                }

                if (graph === graphBeforeRewrites) {
                    assert(intersectionsDone && unionsDone, "Graph didn't change but we're not done");
                }
            } while (!intersectionsDone || !unionsDone);
        }

        this.time(
            "replace object type",
            () =>
                (graph = replaceObjectType(
                    graph,
                    stringTypeMapping,
                    conflateNumbers,
                    targetLanguage.supportsFullObjectType,
                    debugPrintReconstitution
                ))
        );
        do {
            this.time(
                "flatten unions",
                () =>
                    ([graph, unionsDone] = flattenUnions(
                        graph,
                        stringTypeMapping,
                        conflateNumbers,
                        flattenUnionsFlag,
                        false,
                        debugPrintReconstitution
                    ))
            );
        } while (!unionsDone);

        if (this._options.combineClasses) {
            const combinedGraph = this.time("combine classes", () =>
                combineClasses(this, graph, this._options.alphabetizeProperties, true, false, debugPrintReconstitution)
            );
            if (combinedGraph === graph) {
                graph = combinedGraph;
            } else {
                this.time(
                    "combine classes cleanup",
                    () =>
                        (graph = combineClasses(
                            this,
                            combinedGraph,
                            this._options.alphabetizeProperties,
                            false,
                            true,
                            debugPrintReconstitution
                        ))
                );
            }
        }

        if (this._options.inferMaps) {
            for (;;) {
                const newGraph = this.time("infer maps", () =>
                    inferMaps(graph, stringTypeMapping, true, debugPrintReconstitution)
                );
                if (newGraph === graph) {
                    break;
                }
                graph = newGraph;
            }
        }

        const enumInference = allInputs.needSchemaProcessing ? "all" : this._options.inferEnums ? "infer" : "none";
        this.time("expand strings", () => (graph = expandStrings(this, graph, enumInference)));
        this.time(
            "flatten unions",
            () =>
                ([graph, unionsDone] = flattenUnions(
                    graph,
                    stringTypeMapping,
                    conflateNumbers,
                    flattenUnionsFlag,
                    false,
                    debugPrintReconstitution
                ))
        );
        assert(unionsDone, "We should only have to flatten unions once after expanding strings");

        if (allInputs.needSchemaProcessing) {
            this.time(
                "flatten strings",
                () => (graph = flattenStrings(graph, stringTypeMapping, debugPrintReconstitution))
            );
        }

        this.time("none to any", () => (graph = noneToAny(graph, stringTypeMapping, debugPrintReconstitution)));
        if (!targetLanguage.supportsOptionalClassProperties) {
            this.time(
                "optional to nullable",
                () => (graph = optionalToNullable(graph, stringTypeMapping, debugPrintReconstitution))
            );
        }

        this.time("fixed point", () => (graph = graph.rewriteFixedPoint(false, debugPrintReconstitution)));

        this.time("make transformations", () => (graph = makeTransformations(this, graph, targetLanguage)));

        this.time(
            "flatten unions",
            () =>
                ([graph, unionsDone] = flattenUnions(
                    graph,
                    stringTypeMapping,
                    conflateNumbers,
                    flattenUnionsFlag,
                    false,
                    debugPrintReconstitution
                ))
        );
        assert(unionsDone, "We should only have to flatten unions once after making transformations");

        // Sometimes we combine classes in ways that will the order come out
        // differently compared to what it would be from the equivalent schema,
        // so we always just garbage collect to get a defined order and be done
        // with it.
        // FIXME: We don't actually have to do this if any of the above graph
        // rewrites did anything.  We could just check whether the current graph
        // is different from the one we started out with.
        this.time(
            "GC",
            () => (graph = graph.garbageCollect(this._options.alphabetizeProperties, debugPrintReconstitution))
        );

        if (this._options.debugPrintGraph) {
            console.log("\n# gather names");
        }
        this.time("gather names", () =>
            gatherNames(graph, !allInputs.needSchemaProcessing, this._options.debugPrintGatherNames)
        );
        if (this._options.debugPrintGraph) {
            graph.printGraph();
        }

        return graph;
    }

    private makeSimpleTextResult(lines: string[]): MultiFileRenderResult {
        return new Map([[this._options.outputFilename, { lines, annotations: [] }]] as [
            string,
            SerializedRenderResult
        ][]);
    }

    private preRun(): MultiFileRenderResult | [InputData, TargetLanguage] {
        // FIXME: This makes quicktype not quite reentrant
        initTypeNames();

        const targetLanguage = getTargetLanguage(this._options.lang);
        const inputData = this._options.inputData;
        const needIR = inputData.needIR || targetLanguage.names.indexOf("schema") < 0;

        const schemaString = needIR ? undefined : inputData.singleStringSchemaSource();
        if (schemaString !== undefined) {
            const lines = JSON.stringify(JSON.parse(schemaString), undefined, 4).split("\n");
            lines.push("");
            const srr = { lines, annotations: [] };
            return new Map([[this._options.outputFilename, srr] as [string, SerializedRenderResult]]);
        }

        return [inputData, targetLanguage];
    }

    async run(): Promise<MultiFileRenderResult> {
        const preRunResult = this.preRun();
        if (!Array.isArray(preRunResult)) {
            return preRunResult;
        }

        const [inputData, targetLanguage] = preRunResult;

        const graph = await this.makeGraph(inputData);

        return this.renderGraph(targetLanguage, graph);
    }

    runSync(): MultiFileRenderResult {
        const preRunResult = this.preRun();
        if (!Array.isArray(preRunResult)) {
            return preRunResult;
        }

        const [inputData, targetLanguage] = preRunResult;

        const graph = this.makeGraphSync(inputData);

        return this.renderGraph(targetLanguage, graph);
    }

    private renderGraph(targetLanguage: TargetLanguage, graph: TypeGraph): MultiFileRenderResult {
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

/**
 * Run quicktype and produce one or more output files.
 *
 * @param options Partial options.  For options that are not defined, the
 * defaults will be used.
 */
export async function quicktypeMultiFile(options: Partial<Options>): Promise<MultiFileRenderResult> {
    return await new Run(options).run();
}

export function quicktypeMultiFileSync(options: Partial<Options>): MultiFileRenderResult {
    return new Run(options).runSync();
}

function offsetLocation(loc: Location, lineOffset: number): Location {
    return { line: loc.line + lineOffset, column: loc.column };
}

function offsetSpan(span: Span, lineOffset: number): Span {
    return { start: offsetLocation(span.start, lineOffset), end: offsetLocation(span.end, lineOffset) };
}

/**
 * Combines a multi-file render result into a single output.  All the files
 * are concatenated and prefixed with a `//`-style comment giving the
 * filename.
 */
export function combineRenderResults(result: MultiFileRenderResult): SerializedRenderResult {
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

/**
 * Run quicktype like `quicktypeMultiFile`, but if there are multiple
 * output files they will all be squashed into one output, with comments at the
 * start of each file.
 *
 * @param options Partial options.  For options that are not defined, the
 * defaults will be used.
 */
export async function quicktype(options: Partial<Options>): Promise<SerializedRenderResult> {
    const result = await quicktypeMultiFile(options);
    return combineRenderResults(result);
}
