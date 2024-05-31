import { iterableFind } from "collection-utils";

import { type TargetLanguage } from "../TargetLanguage";

import { CJSONTargetLanguage } from "./CJSON";
import { CPlusPlusTargetLanguage } from "./CPlusPlus";
import { CrystalTargetLanguage } from "./Crystal";
import { CSharpTargetLanguage } from "./CSharp";
import { DartTargetLanguage } from "./Dart";
import { ElixirTargetLanguage } from "./Elixir";
import { ElmTargetLanguage } from "./Elm";
import { GoTargetLanguage } from "./Golang";
import { HaskellTargetLanguage } from "./Haskell";
import { JavaTargetLanguage } from "./Java";
import { JavaScriptTargetLanguage } from "./JavaScript";
import { JavaScriptPropTypesTargetLanguage } from "./JavaScriptPropTypes";
import { JSONSchemaTargetLanguage } from "./JSONSchema";
import { KotlinTargetLanguage } from "./Kotlin";
import { ObjectiveCTargetLanguage } from "./Objective-C";
import { PhpTargetLanguage } from "./Php";
import { PikeTargetLanguage } from "./Pike";
import { PythonTargetLanguage } from "./Python";
import { RubyTargetLanguage } from "./Ruby";
import { RustTargetLanguage } from "./Rust";
import { Scala3TargetLanguage } from "./Scala3";
import { SmithyTargetLanguage } from "./Smithy4s";
import { SwiftTargetLanguage } from "./Swift";
import { TypeScriptEffectSchemaTargetLanguage } from "./TypeScriptEffectSchema";
import { FlowTargetLanguage, TypeScriptTargetLanguage } from "./TypeScriptFlow";
import { TypeScriptZodTargetLanguage } from "./TypeScriptZod";

export const all: TargetLanguage[] = [
    new CJSONTargetLanguage(),
    new CPlusPlusTargetLanguage(),
    new CrystalTargetLanguage(),
    new CSharpTargetLanguage(),
    new DartTargetLanguage(),
    new ElixirTargetLanguage(),
    new ElmTargetLanguage(),
    new FlowTargetLanguage(),
    new GoTargetLanguage(),
    new HaskellTargetLanguage(),
    new JavaTargetLanguage(),
    new JavaScriptTargetLanguage(),
    new JavaScriptPropTypesTargetLanguage(),
    new JSONSchemaTargetLanguage(),
    new KotlinTargetLanguage(),
    new ObjectiveCTargetLanguage(),
    new PhpTargetLanguage(),
    new PikeTargetLanguage(),
    new PythonTargetLanguage("Python", ["python", "py"], "py"),
    new RubyTargetLanguage(),
    new RustTargetLanguage(),
    new Scala3TargetLanguage(),
    new SmithyTargetLanguage(),
    new SwiftTargetLanguage(),
    new TypeScriptTargetLanguage(),
    new TypeScriptEffectSchemaTargetLanguage(),
    new TypeScriptZodTargetLanguage()
];

export function languageNamed(name: string, targetLanguages?: TargetLanguage[]): TargetLanguage | undefined {
    if (targetLanguages === undefined) {
        targetLanguages = all;
    }

    const maybeTargetLanguage = iterableFind(targetLanguages, l => l.names.includes(name) || l.displayName === name);
    if (maybeTargetLanguage !== undefined) return maybeTargetLanguage;
    return iterableFind(targetLanguages, l => l.extension === name);
}
