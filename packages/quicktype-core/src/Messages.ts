/* eslint-disable @typescript-eslint/no-explicit-any */
import { type Ref } from "./input/JSONSchemaInput";
import { type StringMap } from "./support/Support";

export type ErrorProperties =
    | { kind: "InternalError"; properties: { message: string } }

    // Misc
    | {
          kind: "MiscJSONParseError";
          properties: { address: string; description: string; message: string };
      }
    | { kind: "MiscReadError"; properties: { fileOrURL: string; message: string } }
    | { kind: "MiscUnicodeHighSurrogateWithoutLowSurrogate"; properties: {} }
    | { kind: "MiscInvalidMinMaxConstraint"; properties: { max: number; min: number } }

    // Inference
    | { kind: "InferenceJSONReferenceNotRooted"; properties: { reference: string } }
    | { kind: "InferenceJSONReferenceToUnion"; properties: { reference: string } }
    | { kind: "InferenceJSONReferenceWrongProperty"; properties: { reference: string } }
    | { kind: "InferenceJSONReferenceInvalidArrayIndex"; properties: { reference: string } }

    // JSON Schema input
    | { kind: "SchemaArrayIsInvalidSchema"; properties: { ref: Ref } }
    | { kind: "SchemaNullIsInvalidSchema"; properties: { ref: Ref } }
    | { kind: "SchemaRefMustBeString"; properties: { actual: string; ref: Ref } }
    | { kind: "SchemaAdditionalTypesForbidRequired"; properties: { ref: Ref } }
    | { kind: "SchemaNoTypeSpecified"; properties: { ref: Ref } }
    | { kind: "SchemaInvalidType"; properties: { ref: Ref; type: string } }
    | { kind: "SchemaFalseNotSupported"; properties: { ref: Ref } }
    | { kind: "SchemaInvalidJSONSchemaType"; properties: { ref: Ref; type: string } }
    | { kind: "SchemaRequiredMustBeStringOrStringArray"; properties: { actual: any; ref: Ref } }
    | { kind: "SchemaRequiredElementMustBeString"; properties: { element: any; ref: Ref } }
    | { kind: "SchemaTypeMustBeStringOrStringArray"; properties: { actual: any } }
    | { kind: "SchemaTypeElementMustBeString"; properties: { element: any; ref: Ref } }
    | { kind: "SchemaArrayItemsMustBeStringOrArray"; properties: { actual: any; ref: Ref } }
    | { kind: "SchemaIDMustHaveAddress"; properties: { id: string; ref: Ref } }
    | { kind: "SchemaWrongAccessorEntryArrayLength"; properties: { operation: string; ref: Ref } }
    | {
          kind: "SchemaSetOperationCasesIsNotArray";
          properties: { cases: any; operation: string; ref: Ref };
      }
    | { kind: "SchemaMoreThanOneUnionMemberName"; properties: { names: string[] } }
    | { kind: "SchemaCannotGetTypesFromBoolean"; properties: { ref: string } }
    | { kind: "SchemaCannotIndexArrayWithNonNumber"; properties: { actual: string; ref: Ref } }
    | { kind: "SchemaIndexNotInArray"; properties: { index: number; ref: Ref } }
    | { kind: "SchemaKeyNotInObject"; properties: { key: string; ref: Ref } }
    | { kind: "SchemaFetchError"; properties: { address: string; base: Ref } }
    | { kind: "SchemaFetchErrorTopLevel"; properties: { address: string } }
    | { kind: "SchemaFetchErrorAdditional"; properties: { address: string } }

    // GraphQL input
    | { kind: "GraphQLNoQueriesDefined"; properties: {} }

    // Driver
    | { kind: "DriverUnknownSourceLanguage"; properties: { lang: string } }
    | { kind: "DriverUnknownOutputLanguage"; properties: { lang: string } }
    | { kind: "DriverMoreThanOneInputGiven"; properties: { topLevel: string } }
    | { kind: "DriverCannotInferNameForSchema"; properties: { uri: string } }
    | { kind: "DriverNoGraphQLQueryGiven"; properties: {} }
    | { kind: "DriverNoGraphQLSchemaInDir"; properties: { dir: string } }
    | { kind: "DriverMoreThanOneGraphQLSchemaInDir"; properties: { dir: string } }
    | { kind: "DriverSourceLangMustBeGraphQL"; properties: {} }
    | { kind: "DriverGraphQLSchemaNeeded"; properties: {} }
    | { kind: "DriverInputFileDoesNotExist"; properties: { filename: string } }
    | { kind: "DriverCannotMixJSONWithOtherSamples"; properties: { dir: string } }
    | { kind: "DriverCannotMixNonJSONInputs"; properties: { dir: string } }
    | { kind: "DriverUnknownDebugOption"; properties: { option: string } }
    | { kind: "DriverNoLanguageOrExtension"; properties: {} }
    | { kind: "DriverCLIOptionParsingFailed"; properties: { message: string } }

    // IR
    | { kind: "IRNoForwardDeclarableTypeInCycle"; properties: {} }
    | { kind: "IRTypeAttributesNotPropagated"; properties: { count: number; indexes: number[] } }
    | { kind: "IRNoEmptyUnions"; properties: {} }

    // Rendering
    | { kind: "RendererUnknownOptionValue"; properties: { name: string; value: string } }

    // TypeScript input
    | { kind: "TypeScriptCompilerError"; properties: { message: string } };

export type ErrorKinds = ErrorProperties["kind"];

type ErrorMessages = { readonly [K in ErrorKinds]: string };

const errorMessages: ErrorMessages = {
    InternalError: "Internal error: ${message}",

    // Misc
    MiscJSONParseError: "Syntax error in ${description} JSON ${address}: ${message}",
    MiscReadError: "Cannot read from file or URL ${fileOrURL}: ${message}",
    MiscUnicodeHighSurrogateWithoutLowSurrogate: "Malformed unicode: High surrogate not followed by low surrogate",
    MiscInvalidMinMaxConstraint: "Invalid min-max constraint: ${min}-${max}",

    // Inference
    InferenceJSONReferenceNotRooted: "JSON reference doesn't start with '#/': ${reference}",
    InferenceJSONReferenceToUnion: "JSON reference points to a union type: ${reference}",
    InferenceJSONReferenceWrongProperty: "JSON reference points to a non-existant property: ${reference}",
    InferenceJSONReferenceInvalidArrayIndex: "JSON reference uses invalid array index: ${reference}",

    // JSON Schema input
    SchemaArrayIsInvalidSchema: "An array is not a valid JSON Schema at ${ref}",
    SchemaNullIsInvalidSchema: "null is not a valid JSON Schema at ${ref}",
    SchemaRefMustBeString: "$ref must be a string, but is an ${actual} at ${ref}",
    SchemaAdditionalTypesForbidRequired:
        "Can't have non-specified required properties but forbidden additionalTypes at ${ref}",
    SchemaNoTypeSpecified: "JSON Schema must specify at least one type at ${ref}",
    SchemaInvalidType: "Invalid type ${type} in JSON Schema at ${ref}",
    SchemaFalseNotSupported: 'Schema "false" is not supported at ${ref}',
    SchemaInvalidJSONSchemaType: "Value of type ${type} is not valid JSON Schema at ${ref}",
    SchemaRequiredMustBeStringOrStringArray:
        "`required` must be string or array of strings, but is ${actual} at ${ref}",
    SchemaRequiredElementMustBeString: "`required` must contain only strings, but it has ${element}, at ${ref}",
    SchemaTypeMustBeStringOrStringArray: "`type` must be string or array of strings, but is ${actual}",
    SchemaTypeElementMustBeString: "`type` must contain only strings, but it has ${element}",
    SchemaArrayItemsMustBeStringOrArray: "Array items must be an array or an object, but is ${actual}",
    SchemaIDMustHaveAddress: "$id ${id} doesn't have an address at ${ref}",
    SchemaWrongAccessorEntryArrayLength:
        "Accessor entry array must have the same number of entries as the ${operation} at ${ref}",
    SchemaSetOperationCasesIsNotArray: "${operation} cases must be an array, but is ${cases}, at ${ref}",
    SchemaMoreThanOneUnionMemberName: "More than one name given for union member: ${names}",
    SchemaCannotGetTypesFromBoolean:
        "Schema value to get top-level types from must be an object, but is boolean, at ${ref}",
    SchemaCannotIndexArrayWithNonNumber:
        "Trying to index array in schema with key that is not a number, but is ${actual} at ${ref}",
    SchemaIndexNotInArray: "Index ${index} out of range of schema array at ${ref}",
    SchemaKeyNotInObject: "Key ${key} not in schema object at ${ref}",
    SchemaFetchError: "Could not fetch schema ${address}, referred to from ${base}",
    SchemaFetchErrorTopLevel: "Could not fetch top-level schema ${address}",
    SchemaFetchErrorAdditional: "Could not fetch additional schema ${address}",

    // GraphQL input
    GraphQLNoQueriesDefined: "GraphQL file doesn't have any queries defined.",

    // Driver
    DriverUnknownSourceLanguage: "Unknown source language ${lang}",
    DriverUnknownOutputLanguage: "Unknown output language ${lang}",
    DriverMoreThanOneInputGiven: "More than one input given for top-level ${topLevel}",
    DriverCannotInferNameForSchema: "Cannot infer name for schema ${uri}",
    DriverNoGraphQLQueryGiven: "Please specify at least one GraphQL query as input",
    DriverNoGraphQLSchemaInDir: "No GraphQL schema in ${dir}",
    DriverMoreThanOneGraphQLSchemaInDir: "More than one GraphQL schema in ${dir}",
    DriverSourceLangMustBeGraphQL: "If a GraphQL schema is specified, the source language must be GraphQL",
    DriverGraphQLSchemaNeeded: "Please specify a GraphQL schema with --graphql-schema or --graphql-introspect",
    DriverInputFileDoesNotExist: "Input file ${filename} does not exist",
    DriverCannotMixJSONWithOtherSamples:
        "Cannot mix JSON samples with JSON Schems, GraphQL, or TypeScript in input subdirectory ${dir}",
    DriverCannotMixNonJSONInputs: "Cannot mix JSON Schema, GraphQL, and TypeScript in an input subdirectory ${dir}",
    DriverUnknownDebugOption: "Unknown debug option ${option}",
    DriverNoLanguageOrExtension: "Please specify a language (--lang) or an output file extension",
    DriverCLIOptionParsingFailed: "Option parsing failed: ${message}",

    // IR
    IRNoForwardDeclarableTypeInCycle:
        "Cannot resolve cycle because it doesn't contain types that can be forward declared",
    IRTypeAttributesNotPropagated:
        "Type attributes for ${count} types were not carried over to the new graph: ${indexes}",
    IRNoEmptyUnions: "Trying to make an empty union - do you have an impossible type in your schema?",

    // Rendering
    RendererUnknownOptionValue: "Unknown value ${value} for option ${name}",

    // TypeScript input
    TypeScriptCompilerError: "TypeScript error: ${message}"
};

export type ErrorPropertiesForKind<K extends ErrorKinds = ErrorKinds> =
    Extract<ErrorProperties, { kind: K }> extends { properties: infer P } ? P : never;

export class QuickTypeError extends Error {
    public constructor(
        public readonly errorMessage: string,
        public readonly messageName: string,
        public userMessage: string,
        public readonly properties: StringMap
    ) {
        super(userMessage);
    }
}

export function messageError<Kind extends ErrorKinds>(kind: Kind, properties: ErrorPropertiesForKind<Kind>): never {
    const message = errorMessages[kind];
    let userMessage: string = message;

    for (const [name, value] of Object.entries(properties as StringMap)) {
        let valueString = "";
        if (typeof value === "object" && typeof value?.toString === "function") {
            valueString = value.toString();
        } else if (typeof value?.message === "string") {
            valueString = value.message;
        } else if (typeof value !== "string") {
            valueString = JSON.stringify(value);
        }

        userMessage = userMessage.replace("${" + name + "}", valueString);
    }

    throw new QuickTypeError(message, kind, userMessage, properties as StringMap);
}

export function messageAssert<Kind extends ErrorKinds>(
    assertion: boolean,
    kind: Kind,
    properties: ErrorPropertiesForKind<Kind>
): void {
    if (assertion) return;
    return messageError(kind, properties);
}
