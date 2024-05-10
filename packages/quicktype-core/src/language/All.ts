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
// eslint-disable-next-line import/no-cycle
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

import type { LanguageDisplayName, LanguageName, LanguageNameMap } from "../types";

export const all = [
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

export function isLanguageName(maybeName: string): maybeName is LanguageName {
    if (all.some(lang => (lang.names as readonly string[]).includes(maybeName))) {
        return true;
    }

    return false;
}

export function isLanguageDisplayName(maybeName: string): maybeName is LanguageDisplayName {
    if (all.some(lang => lang.displayName === maybeName)) {
        return true;
    }

    return false;
}
