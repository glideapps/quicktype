"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.languageNamed = exports.all = void 0;
const collection_utils_1 = require("collection-utils");
const CSharp_1 = require("./CSharp");
const Golang_1 = require("./Golang");
const CPlusPlus_1 = require("./CPlusPlus");
const Objective_C_1 = require("./Objective-C");
const Java_1 = require("./Java");
const JavaScript_1 = require("./JavaScript");
const JavaScriptPropTypes_1 = require("./JavaScriptPropTypes");
const TypeScriptFlow_1 = require("./TypeScriptFlow");
const Swift_1 = require("./Swift");
const Kotlin_1 = require("./Kotlin");
const Elm_1 = require("./Elm");
const JSONSchema_1 = require("./JSONSchema");
const Rust_1 = require("./Rust");
const Crystal_1 = require("./Crystal");
const ruby_1 = require("./ruby");
const Dart_1 = require("./Dart");
const Python_1 = require("./Python");
const Pike_1 = require("./Pike");
const Haskell_1 = require("./Haskell");
const Php_1 = require("./Php");
exports.all = [
    new CSharp_1.CSharpTargetLanguage(),
    new Golang_1.GoTargetLanguage(),
    new Rust_1.RustTargetLanguage(),
    new Crystal_1.CrystalTargetLanguage(),
    new CPlusPlus_1.CPlusPlusTargetLanguage(),
    new Objective_C_1.ObjectiveCTargetLanguage(),
    new Java_1.JavaTargetLanguage(),
    new TypeScriptFlow_1.TypeScriptTargetLanguage(),
    new JavaScript_1.JavaScriptTargetLanguage(),
    new JavaScriptPropTypes_1.JavaScriptPropTypesTargetLanguage(),
    new TypeScriptFlow_1.FlowTargetLanguage(),
    new Swift_1.SwiftTargetLanguage(),
    new Kotlin_1.KotlinTargetLanguage(),
    new Elm_1.ElmTargetLanguage(),
    new JSONSchema_1.JSONSchemaTargetLanguage(),
    new ruby_1.RubyTargetLanguage(),
    new Dart_1.DartTargetLanguage(),
    new Python_1.PythonTargetLanguage("Python", ["python", "py"], "py"),
    new Pike_1.PikeTargetLanguage(),
    new Haskell_1.HaskellTargetLanguage(),
    new Php_1.PhpTargetLanguage()
];
function languageNamed(name, targetLanguages) {
    if (targetLanguages === undefined) {
        targetLanguages = exports.all;
    }
    const maybeTargetLanguage = (0, collection_utils_1.iterableFind)(targetLanguages, l => l.names.indexOf(name) >= 0 || l.displayName === name);
    if (maybeTargetLanguage !== undefined)
        return maybeTargetLanguage;
    return (0, collection_utils_1.iterableFind)(targetLanguages, l => l.extension === name);
}
exports.languageNamed = languageNamed;
