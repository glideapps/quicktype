import { find, includes } from "lodash";

import { TargetLanguage } from "../TargetLanguage";

import CSharpTargetLanguage from "./CSharp";
import GoTargetLanguage from "./Golang";
import CPlusPlusTargetLanguage from "./CPlusPlus";
import ObjectiveCTargetLanguage from "./Objective-C";
import { JavaTargetLanguage } from "./Java";
import { JavaScriptTargetLanguage } from "./JavaScript";
import { TypeScriptTargetLanguage, FlowTargetLanguage } from "./TypeScriptFlow";
import SwiftTargetLanguage from "./Swift";
import ElmTargetLanguage from "./Elm";
import JSONSchemaTargetLanguage from "./JSONSchema";
import RustTargetLanguage from "./Rust";
import RubyTargetLanguage from "./ruby";

export const all: TargetLanguage[] = [
    new CSharpTargetLanguage(),
    new GoTargetLanguage(),
    new RustTargetLanguage(),
    new CPlusPlusTargetLanguage(),
    new ObjectiveCTargetLanguage(),
    new JavaTargetLanguage(),
    new TypeScriptTargetLanguage(),
    new JavaScriptTargetLanguage(),
    new FlowTargetLanguage(),
    new SwiftTargetLanguage(),
    new ElmTargetLanguage(),
    new JSONSchemaTargetLanguage(),
    new RubyTargetLanguage()
];

export function languageNamed(name: string, targetLanguages?: TargetLanguage[]): TargetLanguage | undefined {
    if (targetLanguages === undefined) {
        targetLanguages = all;
    }
    const maybeTargetLanguage = find(targetLanguages, l => includes(l.names, name) || l.displayName === name);
    if (maybeTargetLanguage !== undefined) return maybeTargetLanguage;
    return find(targetLanguages, l => l.extension === name);
}
