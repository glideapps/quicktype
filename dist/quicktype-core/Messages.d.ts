import { StringMap } from "./support/Support";
import { Ref } from "./input/JSONSchemaInput";
export declare type ErrorProperties = {
    kind: "InternalError";
    properties: {
        message: string;
    };
} | {
    kind: "MiscJSONParseError";
    properties: {
        description: string;
        address: string;
        message: string;
    };
} | {
    kind: "MiscReadError";
    properties: {
        fileOrURL: string;
        message: string;
    };
} | {
    kind: "MiscUnicodeHighSurrogateWithoutLowSurrogate";
    properties: {};
} | {
    kind: "MiscInvalidMinMaxConstraint";
    properties: {
        min: number;
        max: number;
    };
} | {
    kind: "InferenceJSONReferenceNotRooted";
    properties: {
        reference: string;
    };
} | {
    kind: "InferenceJSONReferenceToUnion";
    properties: {
        reference: string;
    };
} | {
    kind: "InferenceJSONReferenceWrongProperty";
    properties: {
        reference: string;
    };
} | {
    kind: "InferenceJSONReferenceInvalidArrayIndex";
    properties: {
        reference: string;
    };
} | {
    kind: "SchemaArrayIsInvalidSchema";
    properties: {
        ref: Ref;
    };
} | {
    kind: "SchemaNullIsInvalidSchema";
    properties: {
        ref: Ref;
    };
} | {
    kind: "SchemaRefMustBeString";
    properties: {
        actual: string;
        ref: Ref;
    };
} | {
    kind: "SchemaAdditionalTypesForbidRequired";
    properties: {
        ref: Ref;
    };
} | {
    kind: "SchemaNoTypeSpecified";
    properties: {
        ref: Ref;
    };
} | {
    kind: "SchemaInvalidType";
    properties: {
        type: string;
        ref: Ref;
    };
} | {
    kind: "SchemaFalseNotSupported";
    properties: {
        ref: Ref;
    };
} | {
    kind: "SchemaInvalidJSONSchemaType";
    properties: {
        type: string;
        ref: Ref;
    };
} | {
    kind: "SchemaRequiredMustBeStringOrStringArray";
    properties: {
        actual: any;
        ref: Ref;
    };
} | {
    kind: "SchemaRequiredElementMustBeString";
    properties: {
        element: any;
        ref: Ref;
    };
} | {
    kind: "SchemaTypeMustBeStringOrStringArray";
    properties: {
        actual: any;
    };
} | {
    kind: "SchemaTypeElementMustBeString";
    properties: {
        element: any;
        ref: Ref;
    };
} | {
    kind: "SchemaArrayItemsMustBeStringOrArray";
    properties: {
        actual: any;
        ref: Ref;
    };
} | {
    kind: "SchemaIDMustHaveAddress";
    properties: {
        id: string;
        ref: Ref;
    };
} | {
    kind: "SchemaWrongAccessorEntryArrayLength";
    properties: {
        operation: string;
        ref: Ref;
    };
} | {
    kind: "SchemaSetOperationCasesIsNotArray";
    properties: {
        operation: string;
        cases: any;
        ref: Ref;
    };
} | {
    kind: "SchemaMoreThanOneUnionMemberName";
    properties: {
        names: string[];
    };
} | {
    kind: "SchemaCannotGetTypesFromBoolean";
    properties: {
        ref: string;
    };
} | {
    kind: "SchemaCannotIndexArrayWithNonNumber";
    properties: {
        actual: string;
        ref: Ref;
    };
} | {
    kind: "SchemaIndexNotInArray";
    properties: {
        index: number;
        ref: Ref;
    };
} | {
    kind: "SchemaKeyNotInObject";
    properties: {
        key: string;
        ref: Ref;
    };
} | {
    kind: "SchemaFetchError";
    properties: {
        address: string;
        base: Ref;
    };
} | {
    kind: "SchemaFetchErrorTopLevel";
    properties: {
        address: string;
    };
} | {
    kind: "SchemaFetchErrorAdditional";
    properties: {
        address: string;
    };
} | {
    kind: "GraphQLNoQueriesDefined";
    properties: {};
} | {
    kind: "DriverUnknownSourceLanguage";
    properties: {
        lang: string;
    };
} | {
    kind: "DriverUnknownOutputLanguage";
    properties: {
        lang: string;
    };
} | {
    kind: "DriverMoreThanOneInputGiven";
    properties: {
        topLevel: string;
    };
} | {
    kind: "DriverCannotInferNameForSchema";
    properties: {
        uri: string;
    };
} | {
    kind: "DriverNoGraphQLQueryGiven";
    properties: {};
} | {
    kind: "DriverNoGraphQLSchemaInDir";
    properties: {
        dir: string;
    };
} | {
    kind: "DriverMoreThanOneGraphQLSchemaInDir";
    properties: {
        dir: string;
    };
} | {
    kind: "DriverSourceLangMustBeGraphQL";
    properties: {};
} | {
    kind: "DriverGraphQLSchemaNeeded";
    properties: {};
} | {
    kind: "DriverInputFileDoesNotExist";
    properties: {
        filename: string;
    };
} | {
    kind: "DriverCannotMixJSONWithOtherSamples";
    properties: {
        dir: string;
    };
} | {
    kind: "DriverCannotMixNonJSONInputs";
    properties: {
        dir: string;
    };
} | {
    kind: "DriverUnknownDebugOption";
    properties: {
        option: string;
    };
} | {
    kind: "DriverNoLanguageOrExtension";
    properties: {};
} | {
    kind: "DriverCLIOptionParsingFailed";
    properties: {
        message: string;
    };
} | {
    kind: "IRNoForwardDeclarableTypeInCycle";
    properties: {};
} | {
    kind: "IRTypeAttributesNotPropagated";
    properties: {
        count: number;
        indexes: number[];
    };
} | {
    kind: "IRNoEmptyUnions";
    properties: {};
} | {
    kind: "RendererUnknownOptionValue";
    properties: {
        value: string;
        name: string;
    };
} | {
    kind: "TypeScriptCompilerError";
    properties: {
        message: string;
    };
};
export declare type ErrorKinds = ErrorProperties extends {
    kind: infer K;
} ? K : never;
export declare type ErrorPropertiesForName<K> = Extract<ErrorProperties, {
    kind: K;
}> extends {
    properties: infer P;
} ? P : never;
export declare class QuickTypeError extends Error {
    readonly errorMessage: string;
    readonly messageName: string;
    readonly properties: StringMap;
    constructor(errorMessage: string, messageName: string, userMessage: string, properties: StringMap);
}
export declare function messageError<N extends ErrorKinds>(kind: N, properties: ErrorPropertiesForName<N>): never;
export declare function messageAssert<N extends ErrorKinds>(assertion: boolean, kind: N, properties: ErrorPropertiesForName<N>): void;
