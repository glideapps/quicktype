import { TargetLanguage } from "../TargetLanguage";

import { CSharpTargetLanguage } from "./CSharp";
import { GoTargetLanguage } from "./Golang";
import { CJSONTargetLanguage } from "./CJSON";
import { CPlusPlusTargetLanguage } from "./CPlusPlus";
import { ObjectiveCTargetLanguage } from "./Objective-C";
import { JavaTargetLanguage } from "./Java";
import { JavaScriptTargetLanguage } from "./JavaScript";
import { JavaScriptPropTypesTargetLanguage } from "./JavaScriptPropTypes";
import { TypeScriptTargetLanguage, FlowTargetLanguage } from "./TypeScriptFlow";
import { SwiftTargetLanguage } from "./Swift";
import { KotlinTargetLanguage } from "./Kotlin";
import { Scala3TargetLanguage } from "./Scala3";
import { SmithyTargetLanguage } from "./Smithy4s";
import { ElmTargetLanguage } from "./Elm";
import { JSONSchemaTargetLanguage } from "./JSONSchema";
import { RustTargetLanguage } from "./Rust";
import { CrystalTargetLanguage } from "./Crystal";
import { RubyTargetLanguage } from "./ruby";
import { DartTargetLanguage } from "./Dart";
import { PythonTargetLanguage } from "./Python";
import { PikeTargetLanguage } from "./Pike";
import { HaskellTargetLanguage } from "./Haskell";
import { TypeScriptZodTargetLanguage } from "./TypeScriptZod";
import { PhpTargetLanguage } from "./Php";
import { TypeScriptEffectSchemaTargetLanguage } from "./TypeScriptEffectSchema";
import { ElixirTargetLanguage } from "./Elixir";

import type { LanguageName, LanguageNameMap } from "../types";

export const all = [
    new CJSONTargetLanguage(),
    new CPlusPlusTargetLanguage(),
    new CrystalTargetLanguage(),
    new CSharpTargetLanguage(),
    new ElmTargetLanguage(),
    new DartTargetLanguage(),
    new ElixirTargetLanguage(),
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
    new PythonTargetLanguage(),
    new RubyTargetLanguage(),
    new RustTargetLanguage(),
    new Scala3TargetLanguage(),
    new SmithyTargetLanguage(),
    new SwiftTargetLanguage(),
    new TypeScriptTargetLanguage(),
    new TypeScriptEffectSchemaTargetLanguage(),
    new TypeScriptZodTargetLanguage()
] as const;

all satisfies readonly TargetLanguage[];

export function languageNamed<Name extends LanguageName>(
    name: Name,
    targetLanguages: readonly TargetLanguage[] = all
): LanguageNameMap[Name] {
    const foundLanguage = targetLanguages.find(language => language.names.includes(name));
    if (!foundLanguage) {
        throw new Error(`Unknown language name: ${name}`);
    }

    return foundLanguage as LanguageNameMap[Name];
}
