import { TargetLanguage, MultiFileRenderResult } from "./TargetLanguage";
import { SerializedRenderResult } from "./Source";
import { StringTypeMapping } from "./TypeBuilder";
import { InputData } from "./input/Inputs";
import { TransformedStringTypeKind } from "./Type";
export declare function getTargetLanguage(nameOrInstance: string | TargetLanguage): TargetLanguage;
export declare type RendererOptions = {
    [name: string]: string;
};
export interface InferenceFlag {
    description: string;
    negationDescription: string;
    explanation: string;
    order: number;
    stringType?: TransformedStringTypeKind;
}
export declare const inferenceFlagsObject: {
    /** Whether to infer map types from JSON data */
    inferMaps: {
        description: string;
        negationDescription: string;
        explanation: string;
        order: number;
    };
    /** Whether to infer enum types from JSON data */
    inferEnums: {
        description: string;
        negationDescription: string;
        explanation: string;
        order: number;
    };
    /** Whether to convert UUID strings to UUID objects */
    inferUuids: {
        description: string;
        negationDescription: string;
        explanation: string;
        stringType: "time" | "date" | "date-time" | "uuid" | "uri" | "integer-string" | "number-string" | "bool-string";
        order: number;
    };
    /** Whether to assume that JSON strings that look like dates are dates */
    inferDateTimes: {
        description: string;
        negationDescription: string;
        explanation: string;
        stringType: "time" | "date" | "date-time" | "uuid" | "uri" | "integer-string" | "number-string" | "bool-string";
        order: number;
    };
    /** Whether to convert stringified integers to integers */
    inferIntegerStrings: {
        description: string;
        negationDescription: string;
        explanation: string;
        stringType: "time" | "date" | "date-time" | "uuid" | "uri" | "integer-string" | "number-string" | "bool-string";
        order: number;
    };
    /** Whether to convert stringified booleans to boolean values */
    inferBooleanStrings: {
        description: string;
        negationDescription: string;
        explanation: string;
        stringType: "time" | "date" | "date-time" | "uuid" | "uri" | "integer-string" | "number-string" | "bool-string";
        order: number;
    };
    /** Combine similar classes.  This doesn't apply to classes from a schema, only from inference. */
    combineClasses: {
        description: string;
        negationDescription: string;
        explanation: string;
        order: number;
    };
    /** Whether to treat $ref as references within JSON */
    ignoreJsonRefs: {
        description: string;
        negationDescription: string;
        explanation: string;
        order: number;
    };
};
export declare type InferenceFlagName = keyof typeof inferenceFlagsObject;
export declare const inferenceFlagNames: ("inferMaps" | "inferEnums" | "inferUuids" | "inferDateTimes" | "inferIntegerStrings" | "inferBooleanStrings" | "combineClasses" | "ignoreJsonRefs")[];
export declare const inferenceFlags: {
    [F in InferenceFlagName]: InferenceFlag;
};
export declare type InferenceFlags = {
    [F in InferenceFlagName]: boolean;
};
/**
 * The options type for the main quicktype entry points,
 * `quicktypeMultiFile` and `quicktype`.
 */
export declare type NonInferenceOptions = {
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
};
export declare type Options = NonInferenceOptions & InferenceFlags;
export interface RunContext {
    stringTypeMapping: StringTypeMapping;
    debugPrintReconstitution: boolean;
    debugPrintTransformations: boolean;
    debugPrintSchemaResolving: boolean;
    timeSync<T>(name: string, f: () => Promise<T>): Promise<T>;
    time<T>(name: string, f: () => T): T;
}
export declare const defaultInferenceFlags: InferenceFlags;
/**
 * Run quicktype and produce one or more output files.
 *
 * @param options Partial options.  For options that are not defined, the
 * defaults will be used.
 */
export declare function quicktypeMultiFile(options: Partial<Options>): Promise<MultiFileRenderResult>;
export declare function quicktypeMultiFileSync(options: Partial<Options>): MultiFileRenderResult;
/**
 * Combines a multi-file render result into a single output.  All the files
 * are concatenated and prefixed with a `//`-style comment giving the
 * filename.
 */
export declare function combineRenderResults(result: MultiFileRenderResult): SerializedRenderResult;
/**
 * Run quicktype like `quicktypeMultiFile`, but if there are multiple
 * output files they will all be squashed into one output, with comments at the
 * start of each file.
 *
 * @param options Partial options.  For options that are not defined, the
 * defaults will be used.
 */
export declare function quicktype(options: Partial<Options>): Promise<SerializedRenderResult>;
