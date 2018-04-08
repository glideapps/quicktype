"use strict";

import { StringMap } from "./Support";

export class ErrorMessage {
    static InternalError = "Internal error: ${message}";

    // Misc
    static MiscJSONParseError = "Syntax error in ${description} JSON ${address}: ${message}";
    static MiscReadError = "Cannot read from file or URL ${fileOrURL}: ${message}";
    static MiscUnicodeHighSurrogateWithoutLowSurrogate = "Malformed unicode: High surrogate not followed by low surrogate";

    // JSON Schema input
    static SchemaArrayIsInvalidSchema = "An array is not a valid JSON Schema at ${ref}";
    static SchemaNullIsInvalidSchema = "null is not a valid JSON Schema at ${ref}";
    static SchemaRefMustBeString = "$ref must be a string, but is an ${actual} at ${ref}";
    static SchemaAdditionalTypesForbidRequired = "Can't have non-specified required properties but forbidden additionalTypes";
    static SchemaNoTypeSpecified = "JSON Schema must specify at least one type";
    static SchemaInvalidType = "Invalid type ${type} in JSON Schema at ${ref}";
    static SchemaFalseNotSupported = 'Schema "false" is not supported';
    static SchemaInvalidJSONSchemaType = "Value of type ${type} is not valid JSON Schema at ${ref}";
    static SchemaRequiredMustBeStringOrStringArray = "`required` must be string or array of strings, but is ${actual}";
    static SchemaRequiredElementMustBeString = "`required` must contain only strings, but it has ${element}";
    static SchemaTypeMustBeStringOrStringArray = "`type` must be string or array of strings, but is ${actual}";
    static SchemaTypeElementMustBeString = "`type` must contain only strings, but it has ${element}";
    static SchemaArrayItemsMustBeStringOrArray = "Array items must be an array or an object, but is ${actual}";
    static SchemaIDMustHaveAddress = "$id doesn't have an address: ${id}";
    static SchemaWrongAccessorEntryArrayLength = "Accessor entry array must have the same number of entries as the ${operation}";
    static SchemaSetOperationCasesIsNotArray = "${operation} cases must be an array, but is ${cases}";
    static SchemaCannotFetch = "Cannot fetch schema at address ${address}";
    static SchemaMoreThanOneUnionMemberName = "More than one name given for union member: ${names}";
    static SchemaCannotGetTypesFromBoolean = "Schema value to get top-level types from must be an object, but is boolean, at ${ref}";
    static SchemaCannotIndexArrayWithNonNumber = "Trying to index array in schema with key that is not a number, but is ${actual} at ${ref}";
    static SchemaIndexNotInArray = "Index ${index} out of range of schema array at ${ref}";
    static SchemaKeyNotInObject = "Key ${key} not in schema object at ${ref}";

    // GraphQL input
    static GraphQLNoQueriesDefined = "GraphQL file doesn't have any queries defined.";

    // Driver
    static DriverUnknownSourceLanguage = "Unknown source language ${lang}";
    static DriverUnknownOutputLanguage = "Unknown output language ${lang}";
    static DriverMoreThanOneSchemaGiven = "More than one schema given for ${name}";
    static DriverCannotInferNameForSchema = "Cannot infer name for schema ${uri}";
    static DriverNoGraphQLQueryGiven = "Please specify at least one GraphQL query as input";
    static DriverNoGraphQLSchemaInDir = "No GraphQL schema in ${dir}";
    static DriverMoreThanOneGraphQLSchemaInDir = "More than one GraphQL schema in ${dir}";
    static DriverSourceLangMustBeGraphQL = "If a GraphQL schema is specified, the source language must be GraphQL";
    static DriverGraphQLSchemaNeeded = "Please specify a GraphQL schema with --graphql-schema or --graphql-introspect";
    static DriverInputFileDoesNotExist = "Input file ${filename} does not exist";
    static DriverCannotMixJSONWithOtherSamples = "Cannot mix JSON samples with JSON Schems, GraphQL, or TypeScript in input subdirectory ${dir}";
    static DriverCannotMixNonJSONInputs = "Cannot mix JSON Schema, GraphQL, and TypeScript in an input subdirectory ${dir}";
    static DriverUnknownDebugOption = "Unknown debug option ${option}";
    static DriverNoLanguageOrExtension = "Please specify a language (--lang) or an output file extension";
    static DriverCLIOptionParsingFailed = "Option parsing failed: ${message}";

    // IR
    static IRNoForwardDeclarableTypeInCycle = "Cannot resolve cycle because it doesn't contain types that can be forward declared";
    static IRTypeAttributesNotPropagated = "Type attributes for ${count} types were not carried over to the new graph";
    static IRNoEmptyUnions = "Trying to make an empty union - do you have an impossible type in your schema?";

    // Rendering
    static RendererUnknownOptionValue = "Unknown value ${value} for option ${name}";

    // TypeScript input
    static TypeScriptCompilerError = "TypeScript error: ${message}";
}

/*
type Error =
    | { message: ErrorMessage.InternalError; properties: { message: string } }

    // Misc
    | { message: ErrorMessage.MiscJSONParseError; properties: { description: string; address: string; message: string } }
    | { message: ErrorMessage.MiscReadError; properties: { fileOrURL: string; message: string } }
    | { message: ErrorMessage.MiscUnicodeHighSurrogateWithoutLowSurrogate; properties: {} }

    // JSON Schema input
    | { message: ErrorMessage.SchemaArrayIsInvalidSchema; properties: { ref: Ref } }
    | { message: ErrorMessage.SchemaNullIsInvalidSchema; properties: { ref: Ref } }
    | { message: ErrorMessage.SchemaRefMustBeString; properties: { actual: string; ref: Ref } }
    | { message: ErrorMessage.SchemaAdditionalTypesForbidRequired; properties: {} }
    | { message: ErrorMessage.SchemaNoTypeSpecified; properties: {} }
    | { message: ErrorMessage.SchemaInvalidType; properties: { type: string; ref: Ref } }
    | { message: ErrorMessage.SchemaFalseNotSupported; properties: {} }
    | { message: ErrorMessage.SchemaInvalidJSONSchemaType; properties: { type: string, ref: Ref } }
    | { message: ErrorMessage.SchemaRequiredMustBeStringOrStringArray; properties: { actual: any } }
    | { message: ErrorMessage.SchemaRequiredElementMustBeString; properties: { element: any } }
    | { message: ErrorMessage.SchemaTypeMustBeStringOrStringArray; properties: { actual: any } }
    | { message: ErrorMessage.SchemaTypeElementMustBeString; properties: { element: any; ref: Ref } }
    | { message: ErrorMessage.SchemaArrayItemsMustBeStringOrArray; properties: { actual: any; ref: Ref } }
    | { message: ErrorMessage.SchemaIDMustHaveAddress, properties: { id: string } }
    | { message: ErrorMessage.SchemaWrongAccessorEntryArrayLength, properties: { operation: string } }
    | { message: ErrorMessage.SchemaSetOperationCasesIsNotArray; properties: { operation: string; cases: any } }
    | { message: ErrorMessage.SchemaCannotFetch; properties: { address: string } }
    | { message: ErrorMessage.SchemaMoreThanOneUnionMemberName; properties: { names: string[] } }
    | { message: ErrorMessage.SchemaCannotGetTypesFromBoolean; properties: { ref: string } }
    | { message: ErrorMessage.SchemaCannotIndexArrayWithNonNumber; properties: { actual: string; ref: Ref } }
    | { message: ErrorMessage.SchemaIndexNotInArray; properties: { index: number; ref: Ref } }
    | { message: ErrorMessage.SchemaKeyNotInObject; properties: { key: string; ref: Ref } }

    // GraphQL input
    | { message: ErrorMessage.GraphQLNoQueriesDefined; properties: {} }

    // Driver
    | { message: ErrorMessage.DriverUnknownSourceLanguage; properties: { lang: string } }
    | { message: ErrorMessage.DriverUnknownOutputLanguage; properties: { lang: string } }
    | { message: ErrorMessage.DriverMoreThanOneSchemaGiven; properties: { name: string } }
    | { message: ErrorMessage.DriverCannotInferNameForSchema; properties: { uri: string } }
    | { message: ErrorMessage.DriverNoGraphQLQueryGiven; properties: {} }
    | { message: ErrorMessage.DriverNoGraphQLSchemaInDir; properties: { dir: string } }
    | { message: ErrorMessage.DriverMoreThanOneGraphQLSchemaInDir; properties: { dir: string } }
    | { message: ErrorMessage.DriverSourceLangMustBeGraphQL; properties: {} }
    | { message: ErrorMessage.DriverGraphQLSchemaNeeded; properties: {} }
    | { message: ErrorMessage.DriverInputFileDoesNotExist; properties: { filename: string } }
    | { message: ErrorMessage.DriverCannotMixJSONWithOtherSamples; properties: { dir: string } }
    | { message: ErrorMessage.DriverCannotMixNonJSONInputs; properties: { dir: string } }
    | { message: ErrorMessage.DriverUnknownDebugOption; properties: { option: string } }
    | { message: ErrorMessage.DriverNoLanguageOrExtension; properties: {} }
    | { message: ErrorMessage.DriverCLIOptionParsingFailed; properties: { message: string } }

    // IR
    | { message: ErrorMessage.IRNoForwardDeclarableTypeInCycle; properties: {} }
    | { message: ErrorMessage.IRTypeAttributesNotPropagated; properties: { count: number } }
    | { message: ErrorMessage.IRNoEmptyUnions; properties: {} }

    // Rendering
    | { message: ErrorMessage.RendererUnknownOptionValue; properties: { value: string; name: string } }

    // TypeScript input
    | { message: ErrorMessage.TypeScriptCompilerError; properties: { message: string } }
    ;
*/

/*
type Errors =
   { kind: "foo"; properties: { quux: number } } |
   { kind: "bar"; properties: { frob: boolean } };
type Kind = Errors extends { kind: infer T } ? T : never;
type properties = Errors extends { properties: infer P } ? P : never;
type KindFor<P> = Extract<Errors, { properties: P }> extends { kind: infer K } ? K : never;

const messages: { [kind in Kind]: string } = {
    foo: "Foo error!",
    bar: "A bar is missing!"
};

function error<P extends Props>(kind: KindFor<P>, props: P): void {
    console.log(messages[kind as any], props);
}

error("foo", { quux: 123 });
*/

export class QuickTypeError extends Error {
    constructor(
        readonly errorMessage: string,
        readonly messageName: string,
        userMessage: string,
        readonly properties: StringMap
    ) {
        super(userMessage);
    }
}

export function messageError(message: string): never;
export function messageError(message: string, properties: StringMap): never;
export function messageError(message: string, properties?: StringMap): never {
    let userMessage: string = message;

    if (properties !== undefined) {
        for (const name of Object.getOwnPropertyNames(properties)) {
            let value = properties[name];
            if (typeof value === "object" && typeof value.toString === "function") {
                value = value.toString();
            } else if (typeof value !== "string") {
                value = JSON.stringify(value);
            }
            userMessage = userMessage.replace("${" + name + "}", value);
        }
    } else {
        properties = {};
    }

    let messageName: string | undefined;
    const errorMessages: { [name: string]: string } = ErrorMessage as any;
    for (const name of Object.getOwnPropertyNames(ErrorMessage)) {
        if ((errorMessages[name] as string) === message) {
            messageName = name;
            break;
        }
    }
    if (messageName === undefined) {
        messageName = "UnknownError";
    }

    throw new QuickTypeError(message, messageName, userMessage, properties);
}

export function messageAssert(assertion: boolean, message: string): void;
export function messageAssert(assertion: boolean, message: string, properties: StringMap): void;
export function messageAssert(assertion: boolean, message: string, properties?: StringMap): void {
    if (assertion) return;
    return (messageError as any)(message, properties);
}
