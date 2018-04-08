"use strict";

import { StringMap } from "./Support";

export class ErrorMessage {
    static InternalError = "Internal error: ${message}";

    // Misc
    static JSONParseError = "Syntax error in ${description} JSON ${address}: ${message}";
    static ReadError = "Cannot read from file or URL ${fileOrURL}: ${message}";
    static UnicodeHighSurrogateWithoutLowSurrogate = "Malformed unicode: High surrogate not followed by low surrogate";

    // JSON Schema input
    static ArrayIsInvalidJSONSchema = "An array is not a valid JSON Schema";
    static NullIsInvalidJSONSchema = "null is not a valid JSON Schema";
    static RefMustBeString = "$ref must be a string";
    static AdditionalTypesForbidRequired = "Can't have non-specified required properties but forbidden additionalTypes";
    static NoTypeSpecified = "JSON Schema must specify at least one type";
    static FalseSchemaNotSupported = 'Schema "false" is not supported';
    static InvalidJSONSchemaType = "Value of type ${type} is not valid JSON Schema";
    static RequiredMustBeStringOrStringArray = "`required` must be string or array of strings, but is ${actual}";
    static RequiredElementMustBeString = "`required` must contain only strings, but it has ${element}";
    static TypeMustBeStringOrStringArray = "`type` must be string or array of strings, but is ${actual}";
    static TypeElementMustBeString = "`type` must contain only strings, but it has ${element}";
    static ArrayItemsMustBeStringOrArray = "Array items must be an array or an object, but is ${actual}";
    static IDMustHaveAddress = "$id doesn't have an address: ${id}";
    static WrongAccessorEntryArrayLength = "Accessor entry array must have the same number of entries as the ${operation}";
    static SetOperationCasesIsNotArray = "${operation} cases must be an array, but is ${cases}";
    static CannotFetchSchema = "Cannot fetch schema at address ${address}";
    static MoreThanOneUnionMemberName = "More than one name given for union member: ${names}";
    static CannotGetTypesFromBoolean = "Schema value to get top-level types from must be an object, but is boolean, at ${ref}";

    // GraphQL input
    static NoGraphQLQueriesDefined = "GraphQL file doesn't have any queries defined.";

    // Driver
    static UnknownSourceLanguage = "Unknown source language ${lang}";
    static UnknownOutputLanguage = "Unknown output language ${lang}";
    static MoreThanOneSchemaGiven = "More than one schema given for ${name}";
    static CannotInferNameForSchema = "Cannot infer name for schema ${uri}";
    static NoGraphQLQueryGiven = "Please specify at least one GraphQL query as input";
    static NoGraphQLSchemaInDir = "No GraphQL schema in ${dir}";
    static MoreThanOneGraphQLSchemaInDir = "More than one GraphQL schema in ${dir}";
    static SourceLangMustBeGraphQL = "If a GraphQL schema is specified, the source language must be GraphQL";
    static GraphQLSchemaNeeded = "Please specify a GraphQL schema with --graphql-schema or --graphql-introspect";
    static InputFileDoesNotExist = "Input file ${filename} does not exist";
    static CannotMixJSONWithOtherSamples = "Cannot mix JSON samples with JSON Schems, GraphQL, or TypeScript in input subdirectory ${dir}";
    static CannotMixNonJSONInputs = "Cannot mix JSON Schema, GraphQL, and TypeScript in an input subdirectory ${dir}";
    static UnknownDebugOption = "Unknown debug option ${option}";
    static NoLanguageOrExtension = "Please specify a language (--lang) or an output file extension";
    static CLIOptionParsingFailed = "Option parsing failed: ${message}";

    // IR
    static NoForwardDeclarableTypeInCycle = "Cannot resolve cycle because it doesn't contain types that can be forward declared";
    static TypeAttributesNotPropagated = "Type attributes for ${count} types were not carried over to the new graph";
    static NoEmptyUnions = "Trying to make an empty union - do you have an impossible type in your schema?";

    // Rendering
    static UnknownRendererOptionValue = "Unknown value ${value} for option ${name}";

    // TypeScript input
    static TypeScriptCompilerError = "TypeScript error: ${message}";
}

/*
type Error =
    | { message: ErrorMessage.InternalError; properties: { message: string } }

    // Misc
    | { message: ErrorMessage.JSONParseError; properties: { description: string; address: string; message: string } }
    | { message: ErrorMessage.ReadError; properties: { fileOrURL: string; message: string } }
    | { message: ErrorMessage.UnicodeHighSurrogateWithoutLowSurrogate}

    // JSON Schema input
    | { message: ErrorMessage.ArrayIsInvalidJSONSchema; properties: {} }
    | { message: ErrorMessage.NullIsInvalidJSONSchema; properties: {} }
    | { message: ErrorMessage.RefMustBeString; properties: {} }
    | { message: ErrorMessage.AdditionalTypesForbidRequired; properties: {} }
    | { message: ErrorMessage.NoTypeSpecified; properties: {} }
    | { message: ErrorMessage.FalseSchemaNotSupported; properties: {} }
    | { message: ErrorMessage.InvalidJSONSchemaType; properties: { type: string } }
    | { message: ErrorMessage.RequiredMustBeStringOrStringArray; properties: { actual: any } }
    | { message: ErrorMessage.RequiredElementMustBeString; properties: { element: any } }
    | { message: ErrorMessage.TypeMustBeStringOrStringArray; properties: { actual: any } }
    | { message: ErrorMessage.TypeElementMustBeString; properties: { element: any } }
    | { message: ErrorMessage.ArrayItemsMustBeStringOrArray; properties: { actual: any } }
    | { message: ErrorMessage.IDMustHaveAddress, properties: { id: string } }
    | { message: ErrorMessage.WrongAccessorEntryArrayLength, properties: { operation: string } }
    | { message: ErrorMessage.SetOperationCasesIsNotArray; properties: { operation: string; cases: any } }
    | { message: ErrorMessage.CannotFetchSchema; properties: { address: string } }
    | { message: ErrorMessage.MoreThanOneUnionMemberName; properties: { names: string[] } }
    | { message: ErrorMessage.CannotGetTypesFromBoolean; properties: { ref: string } }

    // GraphQL input
    | { message: ErrorMessage.NoGraphQLQueriesDefined; properties: {} }

    // Driver
    | { message: ErrorMessage.UnknownSourceLanguage; properties: { lang: string } }
    | { message: ErrorMessage.UnknownOutputLanguage; properties: { lang: string } }
    | { message: ErrorMessage.MoreThanOneSchemaGiven; properties: { name: string } }
    | { message: ErrorMessage.CannotInferNameForSchema; properties: { uri: string } }
    | { message: ErrorMessage.NoGraphQLQueryGiven; properties: {} }
    | { message: ErrorMessage.NoGraphQLSchemaInDir; properties: { dir: string } }
    | { message: ErrorMessage.MoreThanOneGraphQLSchemaInDir; properties: { dir: string } }
    | { message: ErrorMessage.SourceLangMustBeGraphQL; properties: {} }
    | { message: ErrorMessage.GraphQLSchemaNeeded; properties: {} }
    | { message: ErrorMessage.InputFileDoesNotExist; properties: { filename: string } }
    | { message: ErrorMessage.CannotMixJSONWithOtherSamples; properties: { dir: string } }
    | { message: ErrorMessage.CannotMixNonJSONInputs; properties: { dir: string } }
    | { message: ErrorMessage.UnknownDebugOption; properties: { option: string } }
    | { message: ErrorMessage.NoLanguageOrExtension; properties: {} }
    | { message: ErrorMessage.CLIOptionParsingFailed; properties: { message: string } }

    // IR
    | { message: ErrorMessage.NoForwardDeclarableTypeInCycle; properties: {} }
    | { message: ErrorMessage.TypeAttributesNotPropagated; properties: { count: number } }
    | { message: ErrorMessage.NoEmptyUnions; properties: {} }

    // Rendering
    | { message: ErrorMessage. UnknownRendererOptionValue; properties: { value: string; name: string } }

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
            if (typeof value !== "string") {
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
