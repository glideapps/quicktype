import type { TransformedStringTypeKind } from "./Type";

export interface InferenceFlag {
    description: string;
    explanation: string;
    negationDescription: string;
    order: number;
    stringType?: TransformedStringTypeKind;
}

export const inferenceFlagsObject = {
    /** Whether to infer map types from JSON data */
    inferMaps: {
        description: "Detect maps",
        negationDescription: "Don't infer maps, always use classes",
        explanation: "Infer maps when object keys look like map keys.",
        order: 1,
    },
    /** Whether to infer enum types from JSON data */
    inferEnums: {
        description: "Detect enums",
        negationDescription: "Don't infer enums, always use strings",
        explanation:
            "If string values occur within a relatively small domain,\ninfer them as enum values.",
        order: 2,
    },
    /** Whether to convert UUID strings to UUID objects */
    inferUuids: {
        description: "Detect UUIDs",
        negationDescription: "Don't convert UUIDs to UUID objects",
        explanation:
            "Detect UUIDs like '123e4567-e89b-12d3-a456-426655440000' (partial support).",
        stringType: "uuid" as TransformedStringTypeKind,
        order: 3,
    },
    /** Whether to assume that JSON strings that look like dates are dates */
    inferDateTimes: {
        description: "Detect dates & times",
        negationDescription: "Don't infer dates or times",
        explanation: "Infer dates from strings (partial support).",
        stringType: "date-time" as TransformedStringTypeKind,
        order: 4,
    },
    /** Whether to convert stringified integers to integers */
    inferIntegerStrings: {
        description: "Detect integers in strings",
        negationDescription: "Don't convert stringified integers to integers",
        explanation:
            'Automatically convert stringified integers to integers.\nFor example, "1" is converted to 1.',
        stringType: "integer-string" as TransformedStringTypeKind,
        order: 5,
    },
    /** Whether to convert stringified booleans to boolean values */
    inferBooleanStrings: {
        description: "Detect booleans in strings",
        negationDescription: "Don't convert stringified booleans to booleans",
        explanation:
            'Automatically convert stringified booleans to booleans.\nFor example, "true" is converted to true.',
        stringType: "bool-string" as TransformedStringTypeKind,
        order: 6,
    },
    /** Combine similar classes.  This doesn't apply to classes from a schema, only from inference. */
    combineClasses: {
        description: "Merge similar classes",
        negationDescription: "Don't combine similar classes",
        explanation:
            "Combine classes with significantly overlapping properties,\ntreating contingent properties as nullable.",
        order: 7,
    },
    /** Whether to treat $ref as references within JSON */
    ignoreJsonRefs: {
        description: "Don't treat $ref as a reference in JSON",
        negationDescription: "Treat $ref as a reference in JSON",
        explanation:
            "Like in JSON Schema, allow objects like\n'{ $ref: \"#/foo/bar\" }' to refer\nto another part of the input.",
        order: 8,
    },
};
export type InferenceFlagName = keyof typeof inferenceFlagsObject;
export const inferenceFlagNames = Object.getOwnPropertyNames(
    inferenceFlagsObject,
) as InferenceFlagName[];
export const inferenceFlags: { [F in InferenceFlagName]: InferenceFlag } =
    inferenceFlagsObject;

export type InferenceFlags = { [F in InferenceFlagName]: boolean };

function makeDefaultInferenceFlags(): InferenceFlags {
    const flags = {} as InferenceFlags;
    for (const flag of inferenceFlagNames) {
        flags[flag] = true;
    }

    return flags;
}

export const defaultInferenceFlags = makeDefaultInferenceFlags();
