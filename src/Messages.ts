"use strict";

import { panic } from "./Support";

export enum ErrorMessage {
    // JSON Schema input
    ArrayIsInvalidJSONSchema = "An array is not a valid JSON Schema",
    NullIsInvalidJSONSchema = "null is not a valid JSON Schema",
    RefMustBeString = "$ref must be a string",
    AdditionalTypesForbidRequired = "Can't have non-specified required properties but forbidden additionalTypes",
    NoTypeSpecified = "JSON Schema must specify at least one type",
    FalseSchemaNotSupported = 'Schema "false" is not supported',
    RefWithFragmentNotAllowed = "Ref URI with fragment is not allowed: ${ref}",
    InvalidJSONSchemaType = "Value of type ${type} is not valid JSON Schema",
    RequiredMustBeStringOrStringArray = "`required` must be string or array of strings, but is ${actual}",
    RequiredElementMustBeString = "`required` must contain only strings, but it has ${element}",
    TypeMustBeStringOrStringArray = "`type` must be string or array of strings, but is ${actual}",
    TypeElementMustBeString = "`type` must contain only strings, but it has ${element}",
    ArrayItemsMustBeStringOrArray = "Array items must be an array or an object, but is ${actual}",
    IDMustHaveAddress = "$id doesn't have an address: ${id}",
    WrongAccessorEntryArrayLength = "Accessor entry array must have the same number of entries as the ${operation}",
    SetOperationCasesIsNotArray = "${operation} cases must be an array, but is ${cases}",
    CannotFetchSchema = "Cannot fetch schema at address ${address}",

    // Driver
    UnknownSourceLanguage = "Unknown source language ${lang}",
    UnknownOutputLanguage = "Unknown output language ${lang}",
    NoGraphQLQueryGiven = "Please specify at least one GraphQL query as input",
    NoGraphQLSchemaInDir = "No GraphQL schema in ${dataDir}",
    InputFileDoesNotExist = "Input file ${filename} does not exist",
    CannotMixJSONWithOtherSamples = "Cannot mix JSON samples with JSON Schems, GraphQL, or TypeScript in input subdirectory ${dir}",
    CannotMixNonJSONInputs = "Cannot mix JSON Schema, GraphQL, and TypeScript in an input subdirectory ${dir}",
    UnknownDebugOption = "Unknown debug option ${option}",

    // IR
    NoForwardDeclarableTypeInCycle = "Cannot resolve cycle because it doesn't contain types that can be forward declared",
    TypeAttributesNotPropagated = "Type attributes for ${count} types were not carried over to the new graph",

    // TypeScript input
    TypeScriptCompilerError = "TypeScript error: ${message}"
}

/*
type Error =
    // JSON Schema input
    | { message: ErrorMessage.ArrayIsInvalidJSONSchema; props: {} }
    | { message: ErrorMessage.NullIsInvalidJSONSchema; props: {} }
    | { message: ErrorMessage.RefMustBeString; props: {} }
    | { message: ErrorMessage.AdditionalTypesForbidRequired; props: {} }
    | { message: ErrorMessage.NoTypeSpecified; props: {} }
    | { message: ErrorMessage.FalseSchemaNotSupported; props: {} }
    | { message: ErrorMessage.RefWithFragmentNotAllowed; props: { ref: string } }
    | { message: ErrorMessage.InvalidJSONSchemaType; props: { type: string } }
    | { message: ErrorMessage.RequiredMustBeStringOrStringArray; props: { actual: any } }
    | { message: ErrorMessage.RequiredElementMustBeString; props: { element: any } }
    | { message: ErrorMessage.TypeMustBeStringOrStringArray; props: { actual: any } }
    | { message: ErrorMessage.TypeElementMustBeString; props: { element: any } }
    | { message: ErrorMessage.ArrayItemsMustBeStringOrArray; props: { actual: any } }
    | { message: ErrorMessage.IDMustHaveAddress, props: { id: string } }
    | { message: ErrorMessage.WrongAccessorEntryArrayLength, props: { operation: string } }
    | { message: ErrorMessage.SetOperationCasesIsNotArray; props: { operation: string; cases: any } }
    | { message: ErrorMessage.CannotFetchSchema; props: { address: string } }

    // Driver
    | { message: ErrorMessage.UnknownSourceLanguage; props: { lang: string } }
    | { message: ErrorMessage.UnknownOutputLanguage; props: { lang: string } }
    | { message: ErrorMessage.NoGraphQLQueryGiven; props: {} }
    | { message: ErrorMessage.NoGraphQLSchemaInDir; props: { dir: string } }
    | { message: ErrorMessage.InputFileDoesNotExist; props: { filename: string } }
    | { message: ErrorMessage.CannotMixJSONWithOtherSamples; props: { dir: string } }
    | { message: ErrorMessage.CannotMixNonJSONInputs; props: { dir: string } }
    | { message: ErrorMessage.UnknownDebugOption; props: { option: string } }

    // IR
    | { message: ErrorMessage.NoForwardDeclarableTypeInCycle; props: {} }
    | { message: ErrorMessage.TypeAttributesNotPropagated; props: { count: number } }

    // TypeScript input
    | { message: ErrorMessage.TypeScriptCompilerError; props: { message: string } }
    */

/*
type Errors =
   { kind: "foo"; props: { quux: number } } |
   { kind: "bar"; props: { frob: boolean } };
type Kind = Errors extends { kind: infer T } ? T : never;
type Props = Errors extends { props: infer P } ? P : never;
type KindFor<P> = Extract<Errors, { props: P }> extends { kind: infer K } ? K : never;

function error<P extends Props>(kind: KindFor<P>, props: P): void {}
*/

export function messageError(message: ErrorMessage): never;
export function messageError(message: ErrorMessage, props: { [name: string]: any }): never;
export function messageError(message: ErrorMessage, props?: { [name: string]: any }): never {
    let userMessage: string = message;

    if (props !== undefined) {
        for (const name of Object.getOwnPropertyNames(props)) {
            let value = props[name];
            if (typeof value !== "string") {
                value = JSON.stringify(value);
            }
            userMessage = userMessage.replace("${" + name + "}", value);
        }
    }

    return panic(userMessage);
}

export function messageAssert(assertion: boolean, message: ErrorMessage): void;
export function messageAssert(assertion: boolean, message: ErrorMessage, props: { [name: string]: any }): void;
export function messageAssert(assertion: boolean, message: ErrorMessage, props?: { [name: string]: any }): void {
    if (assertion) return;
    return (messageError as any)(message, props);
}
