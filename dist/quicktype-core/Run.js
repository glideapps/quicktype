"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const targetLanguages = require("./language/All");
const Support_1 = require("./support/Support");
const CombineClasses_1 = require("./rewrites/CombineClasses");
const InferMaps_1 = require("./rewrites/InferMaps");
const TypeBuilder_1 = require("./TypeBuilder");
const TypeGraph_1 = require("./TypeGraph");
const TypeNames_1 = require("./attributes/TypeNames");
const GatherNames_1 = require("./GatherNames");
const ExpandStrings_1 = require("./rewrites/ExpandStrings");
const FlattenUnions_1 = require("./rewrites/FlattenUnions");
const ResolveIntersections_1 = require("./rewrites/ResolveIntersections");
const ReplaceObjectType_1 = require("./rewrites/ReplaceObjectType");
const Messages_1 = require("./Messages");
const Inputs_1 = require("./input/Inputs");
const FlattenStrings_1 = require("./rewrites/FlattenStrings");
const MakeTransformations_1 = require("./MakeTransformations");
function getTargetLanguage(nameOrInstance) {
    if (typeof nameOrInstance === "object") {
        return nameOrInstance;
    }
    const language = targetLanguages.languageNamed(nameOrInstance);
    if (language !== undefined) {
        return language;
    }
    return Messages_1.messageError("DriverUnknownOutputLanguage", { lang: nameOrInstance });
}
exports.getTargetLanguage = getTargetLanguage;
exports.inferenceFlagsObject = {
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
        stringType: "uuid",
        order: 3
    },
    /** Whether to assume that JSON strings that look like dates are dates */
    inferDateTimes: {
        description: "Detect dates & times",
        negationDescription: "Don't infer dates or times",
        explanation: "Infer dates from strings (partial support).",
        stringType: "date-time",
        order: 4
    },
    /** Whether to convert stringified integers to integers */
    inferIntegerStrings: {
        description: "Detect integers in strings",
        negationDescription: "Don't convert stringified integers to integers",
        explanation: 'Automatically convert stringified integers to integers.\nFor example, "1" is converted to 1.',
        stringType: "integer-string",
        order: 5
    },
    /** Whether to convert stringified booleans to boolean values */
    inferBooleanStrings: {
        description: "Detect booleans in strings",
        negationDescription: "Don't convert stringified booleans to booleans",
        explanation: 'Automatically convert stringified booleans to booleans.\nFor example, "true" is converted to true.',
        stringType: "bool-string",
        order: 6
    },
    /** Combine similar classes.  This doesn't apply to classes from a schema, only from inference. */
    combineClasses: {
        description: "Merge similar classes",
        negationDescription: "Don't combine similar classes",
        explanation: "Combine classes with significantly overlapping properties,\ntreating contingent properties as nullable.",
        order: 7
    },
    /** Whether to treat $ref as references within JSON */
    ignoreJsonRefs: {
        description: "Don't treat $ref as a reference in JSON",
        negationDescription: "Treat $ref as a reference in JSON",
        explanation: "Like in JSON Schema, allow objects like\n'{ $ref: \"#/foo/bar\" }' to refer\nto another part of the input.",
        order: 8
    }
};
exports.inferenceFlagNames = Object.getOwnPropertyNames(exports.inferenceFlagsObject);
exports.inferenceFlags = exports.inferenceFlagsObject;
const defaultOptions = {
    lang: "ts",
    inputData: new Inputs_1.InputData(),
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
    debugPrintSchemaResolving: false
};
function makeDefaultInferenceFlags() {
    const flags = {};
    for (const flag of exports.inferenceFlagNames) {
        flags[flag] = true;
    }
    return flags;
}
exports.defaultInferenceFlags = makeDefaultInferenceFlags();
class Run {
    constructor(options) {
        // We must not overwrite defaults with undefined values, which
        // we sometimes get.
        this._options = Object.assign({}, defaultOptions, exports.defaultInferenceFlags);
        for (const k of Object.getOwnPropertyNames(options)) {
            const v = options[k];
            if (v !== undefined) {
                this._options[k] = v;
            }
        }
    }
    get stringTypeMapping() {
        const targetLanguage = getTargetLanguage(this._options.lang);
        const mapping = new Map(targetLanguage.stringTypeMapping);
        for (const flag of exports.inferenceFlagNames) {
            const stringType = exports.inferenceFlags[flag].stringType;
            if (!this._options[flag] && stringType !== undefined) {
                mapping.set(stringType, "string");
            }
        }
        return mapping;
    }
    get debugPrintReconstitution() {
        return this._options.debugPrintReconstitution === true;
    }
    get debugPrintTransformations() {
        return this._options.debugPrintTransformations;
    }
    get debugPrintSchemaResolving() {
        return this._options.debugPrintSchemaResolving;
    }
    timeSync(name, f) {
        return __awaiter(this, void 0, void 0, function* () {
            const start = Date.now();
            const result = yield f();
            const end = Date.now();
            if (this._options.debugPrintTimes) {
                console.log(`${name} took ${end - start}ms`);
            }
            return result;
        });
    }
    time(name, f) {
        const start = Date.now();
        const result = f();
        const end = Date.now();
        if (this._options.debugPrintTimes) {
            console.log(`${name} took ${end - start}ms`);
        }
        return result;
    }
    makeGraphInputs() {
        const targetLanguage = getTargetLanguage(this._options.lang);
        const stringTypeMapping = this.stringTypeMapping;
        const conflateNumbers = !targetLanguage.supportsUnionsWithBothNumberTypes;
        const typeBuilder = new TypeBuilder_1.TypeBuilder(0, stringTypeMapping, this._options.alphabetizeProperties, this._options.allPropertiesOptional, this._options.checkProvenance, false);
        return { targetLanguage, stringTypeMapping, conflateNumbers, typeBuilder };
    }
    makeGraph(allInputs) {
        return __awaiter(this, void 0, void 0, function* () {
            const graphInputs = this.makeGraphInputs();
            yield this.timeSync("read input", () => __awaiter(this, void 0, void 0, function* () {
                return yield allInputs.addTypes(this, graphInputs.typeBuilder, this._options.inferMaps, this._options.inferEnums, this._options.fixedTopLevels);
            }));
            return this.processGraph(allInputs, graphInputs);
        });
    }
    makeGraphSync(allInputs) {
        const graphInputs = this.makeGraphInputs();
        this.time("read input", () => allInputs.addTypesSync(this, graphInputs.typeBuilder, this._options.inferMaps, this._options.inferEnums, this._options.fixedTopLevels));
        return this.processGraph(allInputs, graphInputs);
    }
    processGraph(allInputs, graphInputs) {
        const { targetLanguage, stringTypeMapping, conflateNumbers, typeBuilder } = graphInputs;
        let graph = typeBuilder.finish();
        if (this._options.debugPrintGraph) {
            graph.setPrintOnRewrite();
            graph.printGraph();
        }
        const debugPrintReconstitution = this.debugPrintReconstitution;
        if (typeBuilder.didAddForwardingIntersection || !this._options.ignoreJsonRefs) {
            this.time("remove indirection intersections", () => (graph = TypeGraph_1.removeIndirectionIntersections(graph, stringTypeMapping, debugPrintReconstitution)));
        }
        let unionsDone = false;
        if (allInputs.needSchemaProcessing || !this._options.ignoreJsonRefs) {
            let intersectionsDone = false;
            do {
                const graphBeforeRewrites = graph;
                if (!intersectionsDone) {
                    this.time("resolve intersections", () => ([graph, intersectionsDone] = ResolveIntersections_1.resolveIntersections(graph, stringTypeMapping, debugPrintReconstitution)));
                }
                if (!unionsDone) {
                    this.time("flatten unions", () => ([graph, unionsDone] = FlattenUnions_1.flattenUnions(graph, stringTypeMapping, conflateNumbers, true, debugPrintReconstitution)));
                }
                if (graph === graphBeforeRewrites) {
                    Support_1.assert(intersectionsDone && unionsDone, "Graph didn't change but we're not done");
                }
            } while (!intersectionsDone || !unionsDone);
        }
        this.time("replace object type", () => (graph = ReplaceObjectType_1.replaceObjectType(graph, stringTypeMapping, conflateNumbers, targetLanguage.supportsFullObjectType, debugPrintReconstitution)));
        do {
            this.time("flatten unions", () => ([graph, unionsDone] = FlattenUnions_1.flattenUnions(graph, stringTypeMapping, conflateNumbers, false, debugPrintReconstitution)));
        } while (!unionsDone);
        if (this._options.combineClasses) {
            const combinedGraph = this.time("combine classes", () => CombineClasses_1.combineClasses(this, graph, this._options.alphabetizeProperties, true, false, debugPrintReconstitution));
            if (combinedGraph === graph) {
                graph = combinedGraph;
            }
            else {
                this.time("combine classes cleanup", () => (graph = CombineClasses_1.combineClasses(this, combinedGraph, this._options.alphabetizeProperties, false, true, debugPrintReconstitution)));
            }
        }
        if (this._options.inferMaps) {
            for (;;) {
                const newGraph = this.time("infer maps", () => InferMaps_1.inferMaps(graph, stringTypeMapping, true, debugPrintReconstitution));
                if (newGraph === graph) {
                    break;
                }
                graph = newGraph;
            }
        }
        const enumInference = allInputs.needSchemaProcessing ? "all" : this._options.inferEnums ? "infer" : "none";
        this.time("expand strings", () => (graph = ExpandStrings_1.expandStrings(this, graph, enumInference)));
        this.time("flatten unions", () => ([graph, unionsDone] = FlattenUnions_1.flattenUnions(graph, stringTypeMapping, conflateNumbers, false, debugPrintReconstitution)));
        Support_1.assert(unionsDone, "We should only have to flatten unions once after expanding strings");
        if (allInputs.needSchemaProcessing) {
            this.time("flatten strings", () => (graph = FlattenStrings_1.flattenStrings(graph, stringTypeMapping, debugPrintReconstitution)));
        }
        this.time("none to any", () => (graph = TypeGraph_1.noneToAny(graph, stringTypeMapping, debugPrintReconstitution)));
        if (!targetLanguage.supportsOptionalClassProperties) {
            this.time("optional to nullable", () => (graph = TypeGraph_1.optionalToNullable(graph, stringTypeMapping, debugPrintReconstitution)));
        }
        this.time("fixed point", () => (graph = graph.rewriteFixedPoint(false, debugPrintReconstitution)));
        this.time("make transformations", () => (graph = MakeTransformations_1.makeTransformations(this, graph, targetLanguage)));
        this.time("flatten unions", () => ([graph, unionsDone] = FlattenUnions_1.flattenUnions(graph, stringTypeMapping, conflateNumbers, false, debugPrintReconstitution)));
        Support_1.assert(unionsDone, "We should only have to flatten unions once after making transformations");
        // Sometimes we combine classes in ways that will the order come out
        // differently compared to what it would be from the equivalent schema,
        // so we always just garbage collect to get a defined order and be done
        // with it.
        // FIXME: We don't actually have to do this if any of the above graph
        // rewrites did anything.  We could just check whether the current graph
        // is different from the one we started out with.
        this.time("GC", () => (graph = graph.garbageCollect(this._options.alphabetizeProperties, debugPrintReconstitution)));
        if (this._options.debugPrintGraph) {
            console.log("\n# gather names");
        }
        this.time("gather names", () => GatherNames_1.gatherNames(graph, !allInputs.needSchemaProcessing, this._options.debugPrintGatherNames));
        if (this._options.debugPrintGraph) {
            graph.printGraph();
        }
        return graph;
    }
    makeSimpleTextResult(lines) {
        return new Map([[this._options.outputFilename, { lines, annotations: [] }]]);
    }
    preRun() {
        // FIXME: This makes quicktype not quite reentrant
        TypeNames_1.initTypeNames();
        const targetLanguage = getTargetLanguage(this._options.lang);
        const inputData = this._options.inputData;
        const needIR = inputData.needIR || targetLanguage.names.indexOf("schema") < 0;
        const schemaString = needIR ? undefined : inputData.singleStringSchemaSource();
        if (schemaString !== undefined) {
            const lines = JSON.stringify(JSON.parse(schemaString), undefined, 4).split("\n");
            lines.push("");
            const srr = { lines, annotations: [] };
            return new Map([[this._options.outputFilename, srr]]);
        }
        return [inputData, targetLanguage];
    }
    run() {
        return __awaiter(this, void 0, void 0, function* () {
            const preRunResult = this.preRun();
            if (!Array.isArray(preRunResult)) {
                return preRunResult;
            }
            const [inputData, targetLanguage] = preRunResult;
            const graph = yield this.makeGraph(inputData);
            return this.renderGraph(targetLanguage, graph);
        });
    }
    runSync() {
        const preRunResult = this.preRun();
        if (!Array.isArray(preRunResult)) {
            return preRunResult;
        }
        const [inputData, targetLanguage] = preRunResult;
        const graph = this.makeGraphSync(inputData);
        return this.renderGraph(targetLanguage, graph);
    }
    renderGraph(targetLanguage, graph) {
        if (this._options.noRender) {
            return this.makeSimpleTextResult(["Done.", ""]);
        }
        return targetLanguage.renderGraphAndSerialize(graph, this._options.outputFilename, this._options.alphabetizeProperties, this._options.leadingComments, this._options.rendererOptions, this._options.indentation);
    }
}
/**
 * Run quicktype and produce one or more output files.
 *
 * @param options Partial options.  For options that are not defined, the
 * defaults will be used.
 */
function quicktypeMultiFile(options) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield new Run(options).run();
    });
}
exports.quicktypeMultiFile = quicktypeMultiFile;
function quicktypeMultiFileSync(options) {
    return new Run(options).runSync();
}
exports.quicktypeMultiFileSync = quicktypeMultiFileSync;
function offsetLocation(loc, lineOffset) {
    return { line: loc.line + lineOffset, column: loc.column };
}
function offsetSpan(span, lineOffset) {
    return { start: offsetLocation(span.start, lineOffset), end: offsetLocation(span.end, lineOffset) };
}
/**
 * Combines a multi-file render result into a single output.  All the files
 * are concatenated and prefixed with a `//`-style comment giving the
 * filename.
 */
function combineRenderResults(result) {
    if (result.size <= 1) {
        const first = collection_utils_1.mapFirst(result);
        if (first === undefined) {
            return { lines: [], annotations: [] };
        }
        return first;
    }
    let lines = [];
    let annotations = [];
    for (const [filename, srr] of result) {
        const offset = lines.length + 2;
        lines = lines.concat([`// ${filename}`, ""], srr.lines);
        annotations = annotations.concat(srr.annotations.map(ann => ({ annotation: ann.annotation, span: offsetSpan(ann.span, offset) })));
    }
    return { lines, annotations };
}
exports.combineRenderResults = combineRenderResults;
/**
 * Run quicktype like `quicktypeMultiFile`, but if there are multiple
 * output files they will all be squashed into one output, with comments at the
 * start of each file.
 *
 * @param options Partial options.  For options that are not defined, the
 * defaults will be used.
 */
function quicktype(options) {
    return __awaiter(this, void 0, void 0, function* () {
        const result = yield quicktypeMultiFile(options);
        return combineRenderResults(result);
    });
}
exports.quicktype = quicktype;
