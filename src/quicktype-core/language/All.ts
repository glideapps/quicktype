import { iterableFind } from "collection-utils";

import { TargetLanguage } from "../TargetLanguage";

import { CSharpTargetLanguage } from "./CSharp";
import { GoTargetLanguage } from "./Golang";
import { CPlusPlusTargetLanguage } from "./CPlusPlus";
import { ObjectiveCTargetLanguage } from "./Objective-C";
import { JavaTargetLanguage } from "./Java";
import { JavaScriptTargetLanguage } from "./JavaScript";
import { JavaScriptPropTypesTargetLanguage } from "./JavaScriptPropTypes";
import { TypeScriptTargetLanguage, FlowTargetLanguage } from "./TypeScriptFlow";
import { SwiftTargetLanguage } from "./Swift";
import { KotlinTargetLanguage } from "./Kotlin";
import { ElmTargetLanguage } from "./Elm";
import { JSONSchemaTargetLanguage } from "./JSONSchema";
import { RustTargetLanguage } from "./Rust";
import { CrystalTargetLanguage } from "./Crystal";
import { RubyTargetLanguage } from "./ruby";
import { DartTargetLanguage } from "./Dart";
import { PythonTargetLanguage } from "./Python";
import { PikeTargetLanguage } from "./Pike";
import { HaskellTargetLanguage } from "./Haskell";
import { PhpTargetLanguage } from "./Php";

export const all: TargetLanguage[] = [
    new CSharpTargetLanguage(),
    new GoTargetLanguage(),
    new RustTargetLanguage(),
    new CrystalTargetLanguage(),
    new CPlusPlusTargetLanguage(),
    new ObjectiveCTargetLanguage(),
    new JavaTargetLanguage(),
    new TypeScriptTargetLanguage(),
    new JavaScriptTargetLanguage(),
    new JavaScriptPropTypesTargetLanguage(),
    new FlowTargetLanguage(),
    new SwiftTargetLanguage(),
    new KotlinTargetLanguage(),
    new ElmTargetLanguage(),
    new JSONSchemaTargetLanguage(),
    new RubyTargetLanguage(),
    new DartTargetLanguage(),
    new PythonTargetLanguage("Python", ["python", "py"], "py"),
    new PikeTargetLanguage(),
    new HaskellTargetLanguage(),
    new PhpTargetLanguage()
];

export function languageNamed(name: string, targetLanguages?: TargetLanguage[]): TargetLanguage | undefined {
    if (targetLanguages === undefined) {
        targetLanguages = all;
    }
    const maybeTargetLanguage = iterableFind(
        targetLanguages,
        l => l.names.indexOf(name) >= 0 || l.displayName === name
    );
    if (maybeTargetLanguage !== undefined) return maybeTargetLanguage;
    return iterableFind(targetLanguages, l => l.extension === name);
}
