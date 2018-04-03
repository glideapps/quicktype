"use strict";

import { panic } from "./Support";

export enum ErrorMessage {
    ArrayIsInvalidJSONSchema = "An array is not a valid JSON Schema",
    NullIsInvalidJSONSchema = "null is not a valid JSON Schema",
    RefMustBeString = "$ref must be a string",
    AdditionalTypesForbidRequired = "Can't have non-specified required properties but forbidden additionalTypes",
    NoTypeSpecified = "JSON Schema must specify at least one type",
    FalseSchemaNotSupported = 'Schema "false" is not supported',
    RefWithFragmentNotAllowed = "Ref URI with fragment is not allowed: ${ref}",
    InvalidJSONSchemaType = "Value of type ${type} is not valid JSON Schemas",
    RequiredMustBeStringOrStringArray = "`required` must be string or array of strings, but is ${actual}",
    RequiredElementMustBeString = "`required` must contain only strings, but it has ${element}",
    TypeMustBeStringOrStringArray = "`type` must be string or array of strings, but is ${actual}",
    TypeElementMustBeString = "`type` must contain only strings, but it has ${element}",
    ArrayItemsMustBeStringOrArray = "Array items must be an array or an object, but is ${actual}",
    IDMustHaveAddress = "$id doesn't have an address: ${id}",
    WrongAccessorEntryArrayLength = "Accessor entry array must have the same number of entries as the ${operation}",
    SetOperationCasesIsNotArray = "${operation} cases must be an array, but is ${cases}"
}

/*
type Error =
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
    | { message: ErrorMessage.SetOperationCasesIsNotArray; props: { operation: string; cases: any } };
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
