import { mapFirst } from "collection-utils";

import { initTypeNames } from "./attributes/TypeNames";
import { InputData } from "./input/Inputs";
import * as targetLanguages from "./language/All";
import type { RendererOptions } from "./language/options.types";
import type { LanguageName } from "./language/types";
import { combineClasses } from "./rewrites/CombineClasses";
import { expandStrings } from "./rewrites/ExpandStrings";
import { flattenStrings } from "./rewrites/FlattenStrings";
import { flattenUnions } from "./rewrites/FlattenUnions";
import { inferMaps } from "./rewrites/InferMaps";
import { replaceObjectType } from "./rewrites/ReplaceObjectType";
import { resolveIntersections } from "./rewrites/ResolveIntersections";
import type { Comment } from "./support/Comments";
import { assert } from "./support/Support";

import { gatherNames } from "./GatherNames";
import {
    type InferenceFlags,
    defaultInferenceFlags,
    inferenceFlagNames,
    inferenceFlags,
} from "./Inference";
import { makeTransformations } from "./MakeTransformations";
import { messageError } from "./Messages";
import type {
    Annotation,
    Location,
    SerializedRenderResult,
    Span,
} from "./Source";
import type { MultiFileRenderResult, TargetLanguage } from "./TargetLanguage";
import { TypeBuilder } from "./Type/TypeBuilder";
import type { StringTypeMapping } from "./Type/TypeBuilderUtils";
import { TypeGraph } from "./Type/TypeGraph";
import {
    noneToAny,
    optionalToNullable,
    removeIndirectionIntersections,
} from "./Type/TypeGraphUtils";

export function getTargetLanguage(
    nameOrInstance: LanguageName | TargetLanguage,
): TargetLanguage {
    if (typeof nameOrInstance === "object") {
        return nameOrInstance;
    }

    const language = targetLanguages.languageNamed(nameOrInstance);
    if (language !== undefined) {
        return language;
    }

    return messageError("DriverUnknownOutputLanguage", {
        lang: nameOrInstance,
    });
}

/**
 * The options type for the main quicktype entry points,
 * `quicktypeMultiFile` and `quicktype`.
 */
export interface NonInferenceOptions<Lang extends LanguageName = LanguageName> {
    /** Make all class property optional */
    allPropertiesOptional: boolean;
    /** Put class properties in alphabetical order, instead of in the order found in the JSON */
    alphabetizeProperties: boolean;
    /** Check that we're propagating all type attributes (unless we actually can't) */
    checkProvenance: boolean;
    /**
     * Print name gathering debug information to the console.  This might help to figure out why
     * your types get weird names, but the output is quite arcane.
     */
    debugPrintGatherNames: boolean;
    /** Print the type graph to the console at every processing step */
    debugPrintGraph: boolean;
    /**
     * Print type reconstitution debug information to the console.  You'll only ever need this if
     * you're working deep inside quicktype-core.
     */
    debugPrintReconstitution: boolean;
    /** Print schema resolving steps */
    debugPrintSchemaResolving: boolean;
    /** Print the time it took for each pass to run */
    debugPrintTimes: boolean;
    /** Print all transformations to the console prior to generating code */
    debugPrintTransformations: boolean;
    /**
     * Make top-levels classes from JSON fixed.  That means even if two top-level classes are exactly
     * the same, quicktype will still generate two separate types for them.
     */
    fixedTopLevels: boolean;
    /** String to use for one indentation level.  If not given, use the target language's default. */
    indentation: string | undefined;
    /** The input data from which to produce types */
    inputData: InputData;
    /**
     * The target language for which to produce code.  This can be either an instance of `TargetLanguage`,
     * or a string specifying one of the names for quicktype's built-in target languages.  For example,
     * both `cs` and `csharp` will generate C#.
     */
    lang: Lang | TargetLanguage;
    /** If given, output these comments at the beginning of the main output file */
    leadingComments?: Comment[];
    /** Don't render output.  This is mainly useful for benchmarking. */
    noRender: boolean;
    /** Name of the output file.  Note that quicktype will not write that file, but you'll get its name
     * back as a key in the resulting `Map`.
     */
    outputFilename: string;
    /** Options for the target language's renderer */
    rendererOptions: RendererOptions<Lang>;
}

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
};

export interface RunContext {
    debugPrintReconstitution: boolean;
    debugPrintSchemaResolving: boolean;
    debugPrintTransformations: boolean;
    stringTypeMapping: StringTypeMapping;

    time: <T>(name: string, f: () => T) => T;
    timeSync: <T>(name: string, f: () => Promise<T>) => Promise<T>;
}

interface GraphInputs {
    conflateNumbers: boolean;
    stringTypeMapping: StringTypeMapping;
    targetLanguage: TargetLanguage;
    typeBuilder: TypeBuilder;
}

class Run implements RunContext {
    private readonly _options: Options;

    public constructor(options: Partial<Options>) {
        // We must not overwrite defaults with undefined values, which
        // we sometimes get.
        this._options = Object.fromEntries(
            Object.entries(
                Object.assign({}, defaultOptions, defaultInferenceFlags),
            ).map(([k, v]) => [k, options[k as keyof typeof options] ?? v]),
        ) as Required<typeof options>;
    }

    public get stringTypeMapping(): StringTypeMapping {
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

    public get debugPrintReconstitution(): boolean {
        return this._options.debugPrintReconstitution === true;
    }

    public get debugPrintTransformations(): boolean {
        return this._options.debugPrintTransformations;
    }

    public get debugPrintSchemaResolving(): boolean {
        return this._options.debugPrintSchemaResolving;
    }

    public async timeSync<T>(name: string, f: () => Promise<T>): Promise<T> {
        const start = Date.now();
        const result = await f();
        const end = Date.now();
        if (this._options.debugPrintTimes) {
            console.log(`${name} took ${end - start}ms`);
        }

        return result;
    }

    public time<T>(name: string, f: () => T): T {
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
        const conflateNumbers =
            !targetLanguage.supportsUnionsWithBothNumberTypes;
        const typeBuilder = new TypeBuilder(
            stringTypeMapping,
            this._options.alphabetizeProperties,
            this._options.allPropertiesOptional,
            this._options.checkProvenance,
            false,
        );
        typeBuilder.typeGraph = new TypeGraph(
            typeBuilder,
            0,
            this._options.checkProvenance,
        );

        return {
            targetLanguage,
            stringTypeMapping,
            conflateNumbers,
            typeBuilder,
        };
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
                    this._options.fixedTopLevels,
                ),
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
                this._options.fixedTopLevels,
            ),
        );

        return this.processGraph(allInputs, graphInputs);
    }

    private processGraph(
        allInputs: InputData,
        graphInputs: GraphInputs,
    ): TypeGraph {
        const {
            targetLanguage,
            stringTypeMapping,
            conflateNumbers,
            typeBuilder,
        } = graphInputs;

        let graph = typeBuilder.finish();
        if (this._options.debugPrintGraph) {
            graph.setPrintOnRewrite();
            graph.printGraph();
        }

        const debugPrintReconstitution = this.debugPrintReconstitution;

        if (
            typeBuilder.didAddForwardingIntersection ||
            !this._options.ignoreJsonRefs
        ) {
            this.time("remove indirection intersections", () => {
                graph = removeIndirectionIntersections(
                    graph,
                    stringTypeMapping,
                    debugPrintReconstitution,
                );
            });
        }

        let unionsDone = false;
        if (allInputs.needSchemaProcessing || !this._options.ignoreJsonRefs) {
            let intersectionsDone = false;
            do {
                const graphBeforeRewrites = graph;
                if (!intersectionsDone) {
                    this.time("resolve intersections", () => {
                        [graph, intersectionsDone] = resolveIntersections(
                            graph,
                            stringTypeMapping,
                            debugPrintReconstitution,
                        );
                    });
                }

                if (!unionsDone) {
                    this.time("flatten unions", () => {
                        [graph, unionsDone] = flattenUnions(
                            graph,
                            stringTypeMapping,
                            conflateNumbers,
                            true,
                            debugPrintReconstitution,
                        );
                    });
                }

                if (graph === graphBeforeRewrites) {
                    assert(
                        intersectionsDone && unionsDone,
                        "Graph didn't change but we're not done",
                    );
                }
            } while (!intersectionsDone || !unionsDone);
        }

        this.time("replace object type", () => {
            graph = replaceObjectType(
                graph,
                stringTypeMapping,
                conflateNumbers,
                targetLanguage.supportsFullObjectType,
                debugPrintReconstitution,
            );
        });
        do {
            this.time("flatten unions", () => {
                [graph, unionsDone] = flattenUnions(
                    graph,
                    stringTypeMapping,
                    conflateNumbers,
                    false,
                    debugPrintReconstitution,
                );
            });
        } while (!unionsDone);

        if (this._options.combineClasses) {
            const combinedGraph = this.time("combine classes", () =>
                combineClasses(
                    this,
                    graph,
                    this._options.alphabetizeProperties,
                    true,
                    false,
                    debugPrintReconstitution,
                ),
            );
            if (combinedGraph === graph) {
                graph = combinedGraph;
            } else {
                this.time("combine classes cleanup", () => {
                    graph = combineClasses(
                        this,
                        combinedGraph,
                        this._options.alphabetizeProperties,
                        false,
                        true,
                        debugPrintReconstitution,
                    );
                });
            }
        }

        if (this._options.inferMaps) {
            for (;;) {
                const newGraph = this.time("infer maps", () =>
                    inferMaps(
                        graph,
                        stringTypeMapping,
                        true,
                        debugPrintReconstitution,
                    ),
                );
                if (newGraph === graph) {
                    break;
                }

                graph = newGraph;
            }
        }

        const enumInference = allInputs.needSchemaProcessing
            ? "all"
            : this._options.inferEnums
              ? "infer"
              : "none";
        this.time("expand strings", () => {
            graph = expandStrings(this, graph, enumInference);
        });
        this.time("flatten unions", () => {
            [graph, unionsDone] = flattenUnions(
                graph,
                stringTypeMapping,
                conflateNumbers,
                false,
                debugPrintReconstitution,
            );
        });
        assert(
            unionsDone,
            "We should only have to flatten unions once after expanding strings",
        );

        if (allInputs.needSchemaProcessing) {
            this.time("flatten strings", () => {
                graph = flattenStrings(
                    graph,
                    stringTypeMapping,
                    debugPrintReconstitution,
                );
            });
        }

        this.time("none to any", () => {
            graph = noneToAny(
                graph,
                stringTypeMapping,
                debugPrintReconstitution,
            );
        });
        if (!targetLanguage.supportsOptionalClassProperties) {
            this.time("optional to nullable", () => {
                graph = optionalToNullable(
                    graph,
                    stringTypeMapping,
                    debugPrintReconstitution,
                );
            });
        }

        this.time("fixed point", () => {
            graph = graph.rewriteFixedPoint(false, debugPrintReconstitution);
        });

        this.time("make transformations", () => {
            graph = makeTransformations(this, graph, targetLanguage);
        });

        this.time("flatten unions", () => {
            [graph, unionsDone] = flattenUnions(
                graph,
                stringTypeMapping,
                conflateNumbers,
                false,
                debugPrintReconstitution,
            );
        });
        assert(
            unionsDone,
            "We should only have to flatten unions once after making transformations",
        );

        // Sometimes we combine classes in ways that will the order come out
        // differently compared to what it would be from the equivalent schema,
        // so we always just garbage collect to get a defined order and be done
        // with it.
        // FIXME: We don't actually have to do this if any of the above graph
        // rewrites did anything.  We could just check whether the current graph
        // is different from the one we started out with.
        this.time("GC", () => {
            graph = graph.garbageCollect(
                this._options.alphabetizeProperties,
                debugPrintReconstitution,
            );
        });

        if (this._options.debugPrintGraph) {
            console.log("\n# gather names");
        }

        this.time("gather names", () =>
            gatherNames(
                graph,
                !allInputs.needSchemaProcessing,
                this._options.debugPrintGatherNames,
            ),
        );
        if (this._options.debugPrintGraph) {
            graph.printGraph();
        }

        return graph;
    }

    private makeSimpleTextResult(lines: string[]): MultiFileRenderResult {
        return new Map([
            [this._options.outputFilename, { lines, annotations: [] }],
        ] as Array<[string, SerializedRenderResult]>);
    }

    private preRun(): MultiFileRenderResult | [InputData, TargetLanguage] {
        // FIXME: This makes quicktype not quite reentrant
        initTypeNames();

        const targetLanguage = getTargetLanguage(this._options.lang);
        const inputData = this._options.inputData;
        const needIR =
            inputData.needIR || !targetLanguage.names.includes("schema");

        const schemaString = needIR
            ? undefined
            : inputData.singleStringSchemaSource();
        if (schemaString !== undefined) {
            const lines = JSON.stringify(
                JSON.parse(schemaString),
                undefined,
                4,
            ).split("\n");
            lines.push("");
            const srr = { lines, annotations: [] };
            return new Map([
                [this._options.outputFilename, srr] as [
                    string,
                    SerializedRenderResult,
                ],
            ]);
        }

        return [inputData, targetLanguage];
    }

    public async run(): Promise<MultiFileRenderResult> {
        const preRunResult = this.preRun();
        if (!Array.isArray(preRunResult)) {
            return preRunResult;
        }

        const [inputData, targetLanguage] = preRunResult;

        const graph = await this.makeGraph(inputData);

        return this.renderGraph(targetLanguage, graph);
    }

    public runSync(): MultiFileRenderResult {
        const preRunResult = this.preRun();
        if (!Array.isArray(preRunResult)) {
            return preRunResult;
        }

        const [inputData, targetLanguage] = preRunResult;

        const graph = this.makeGraphSync(inputData);

        return this.renderGraph(targetLanguage, graph);
    }

    private renderGraph(
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
    ): MultiFileRenderResult {
        if (this._options.noRender) {
            return this.makeSimpleTextResult(["Done.", ""]);
        }

        return targetLanguage.renderGraphAndSerialize(
            graph,
            this._options.outputFilename,
            this._options.alphabetizeProperties,
            this._options.leadingComments,
            this._options.rendererOptions,
            this._options.indentation,
        );
    }
}

/**
 * Run quicktype and produce one or more output files.
 *
 * @param options Partial options.  For options that are not defined, the
 * defaults will be used.
 */
export async function quicktypeMultiFile(
    options: Partial<Options>,
): Promise<MultiFileRenderResult> {
    return await new Run(options).run();
}

export function quicktypeMultiFileSync(
    options: Partial<Options>,
): MultiFileRenderResult {
    return new Run(options).runSync();
}

function offsetLocation(loc: Location, lineOffset: number): Location {
    return { line: loc.line + lineOffset, column: loc.column };
}

function offsetSpan(span: Span, lineOffset: number): Span {
    return {
        start: offsetLocation(span.start, lineOffset),
        end: offsetLocation(span.end, lineOffset),
    };
}

/**
 * Combines a multi-file render result into a single output.  All the files
 * are concatenated and prefixed with a `//`-style comment giving the
 * filename.
 */
export function combineRenderResults(
    result: MultiFileRenderResult,
): SerializedRenderResult {
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
            srr.annotations.map((ann) => ({
                annotation: ann.annotation,
                span: offsetSpan(ann.span, offset),
            })),
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
export async function quicktype(
    options: Partial<Options>,
): Promise<SerializedRenderResult> {
    const result = await quicktypeMultiFile(options);
    return combineRenderResults(result);
}
