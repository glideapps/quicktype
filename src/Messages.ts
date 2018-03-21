"use strict";

import { panic } from "./Support";

export enum ErrorMessage {
    ArrayIsInvalidJSONSchema = "An array is not a valid JSON Schema",
    NullIsInvalidJSONSchema = "null is not a valid JSON Schema",
    RefMustBeString = "$ref must be a string",
    AdditionalTypesForbidRequired = "Can't have non-specified required properties but forbidden additionalTypes"
}

export enum ErrorMessageWithInfo {
    RefWithFragmentNotAllowed = "Ref URI with fragment is not allowed: %s",
    InvalidJSONSchemaType = "Value of type %s is not valid JSON Schemas",
    RequiredMustBeStringOrStringArray = "`required` must be string or array of strings, but is %s",
    RequiredElementMustBeString = "`required` must only contain strings, but it has %s",
    TypeMustBeStringOrStringArray = "`type` must be string or array of strings, but is %s",
    TypeElementMustBeString = "`type` must only contain strings, but it has %s"
}

export enum ErrorMessageWithTwoInfos {
    SetOperationCasesIsNotArray = "%s cases must be an array, but is %s"
}

export function messageError(message: ErrorMessage): never;
export function messageError(message: ErrorMessageWithInfo, info: string): never;
export function messageError(message: ErrorMessageWithTwoInfos, info1: string, info2: string): never;
export function messageError(message: string, ...infos: string[]): never {
    for (const info of infos) {
        // FIXME: this won't work if one of the infos, apart from the last, contains "%s"
        message = message.replace("%s", info);
    }
    return panic(message);
}

export function messageAssert(assertion: boolean, message: ErrorMessage): void;
export function messageAssert(assertion: boolean, message: ErrorMessageWithInfo, info: string): void;
export function messageAssert(
    assertion: boolean,
    message: ErrorMessageWithTwoInfos,
    info1: string,
    info2: string
): void;
export function messageAssert(assertion: boolean, message: string, ...infos: string[]): void {
    if (assertion) return;
    return (messageError as any)(message, ...infos);
}
