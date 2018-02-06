import { find, includes } from "lodash";

import { TargetLanguage } from "../TargetLanguage";

import CSharpTargetLanguage from "./CSharp";
import GoTargetLanguage from "./Golang";
import CPlusPlusTargetLanguage from "./CPlusPlus";
import ObjectiveCTargetLanguage from "./Objective-C";
import { JavaTargetLanguage } from "./Java";
import SimpleTypesTargetLanguage from "./SimpleTypes";
import TypeScriptTargetLanguage from "./TypeScript";
import SwiftTargetLanguage from "./Swift";
import ElmTargetLanguage from "./Elm";
import JSONSchemaTargetLanguage from "./JSONSchema";
import RustTargetLanguage from "./Rust";

export const all: TargetLanguage[] = [
    new CSharpTargetLanguage(),
    new GoTargetLanguage(),
    new RustTargetLanguage(),
    new CPlusPlusTargetLanguage(),
    new ObjectiveCTargetLanguage(),
    new JavaTargetLanguage(),
    new TypeScriptTargetLanguage(),
    new SwiftTargetLanguage(),
    new ElmTargetLanguage(),
    new JSONSchemaTargetLanguage(),
    new SimpleTypesTargetLanguage()
];

export function languageNamed(name: string): TargetLanguage | undefined {
    return find(all, l => includes(l.names, name) || l.displayName === name || l.extension === name);
}
