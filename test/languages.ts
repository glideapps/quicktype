"use strict";

import { RendererOptions } from "../dist";

export interface Language {
  name: string;
  base: string;
  setupCommand?: string;
  compileCommand?: string;
  runCommand(sample: string): string;
  diffViaSchema: boolean;
  allowMissingNull: boolean;
  output: string;
  topLevel: string;
  skipJSON: string[];
  skipMiscJSON: boolean;
  skipSchema: string[];
  rendererOptions: RendererOptions;
  quickTestRendererOptions: RendererOptions[];
  sourceFiles?: string[];
}

export const CSharpLanguage: Language = {
  name: "csharp",
  base: "test/fixtures/csharp",
  // https://github.com/dotnet/cli/issues/1582
  setupCommand: "dotnet restore --no-cache",
  runCommand(sample: string) {
    return `dotnet run "${sample}"`;
  },
  diffViaSchema: true,
  allowMissingNull: false,
  output: "QuickType.cs",
  topLevel: "TopLevel",
  skipJSON: [
    "31189.json" // JSON.NET doesn't accept year 0000 as 1BC, though it should
  ],
  skipMiscJSON: false,
  skipSchema: [],
  rendererOptions: {},
  quickTestRendererOptions: [
    { "array-type": "list" },
    { "csharp-version": "5" },
    { density: "dense" }
  ],
  sourceFiles: ["src/Language/CSharp.ts"]
};

export const JavaLanguage: Language = {
  name: "java",
  base: "test/fixtures/java",
  compileCommand: "mvn package",
  runCommand(sample: string) {
    return `java -cp target/QuickTypeTest-1.0-SNAPSHOT.jar io.quicktype.App "${sample}"`;
  },
  // FIXME: implement comparing multiple files
  diffViaSchema: false,
  allowMissingNull: false,
  output: "src/main/java/io/quicktype/TopLevel.java",
  topLevel: "TopLevel",
  skipJSON: [
    "identifiers.json",
    "simple-identifiers.json",
    "nst-test-suite.json"
  ],
  skipMiscJSON: false,
  skipSchema: ["keyword-unions.schema"], // generates classes with names that are case-insensitively equal
  rendererOptions: {},
  quickTestRendererOptions: [],
  sourceFiles: ["src/Language/Java.ts"]
};

export const RustLanguage: Language = {
  name: "rust",
  base: "test/fixtures/rust",
  compileCommand: "cargo build",
  runCommand(sample: string) {
    return `./target/debug/quick_type_test "${sample}"`;
  },
  // FIXME: implement comparing multiple files
  diffViaSchema: false,
  allowMissingNull: false,
  output: "module_under_test.rs",
  topLevel: "TopLevel",
  skipJSON: [],
  skipSchema: [],
  skipMiscJSON: true,
  rendererOptions: {},
  quickTestRendererOptions: [{ density: "dense" }],
  sourceFiles: ["src/Language/Rust.ts"]
};

export const GoLanguage: Language = {
  name: "golang",
  base: "test/fixtures/golang",
  runCommand(sample: string) {
    return `go run main.go quicktype.go < "${sample}"`;
  },
  diffViaSchema: true,
  allowMissingNull: false,
  output: "quicktype.go",
  topLevel: "TopLevel",
  skipJSON: [
    "identifiers.json",
    "simple-identifiers.json",
    "blns-object.json",
    "nst-test-suite.json"
  ],
  skipMiscJSON: false,
  skipSchema: [],
  rendererOptions: {},
  quickTestRendererOptions: [],
  sourceFiles: ["src/Language/Golang.ts"]
};

export const CPlusPlusLanguage: Language = {
  name: "cplusplus",
  base: "test/fixtures/cplusplus",
  setupCommand:
    "curl -o json.hpp https://raw.githubusercontent.com/nlohmann/json/87df1d6708915ffbfa26a051ad7562ecc22e5579/src/json.hpp",
  compileCommand: "g++ -O0 -o quicktype -std=c++14 main.cpp",
  runCommand(sample: string) {
    return `./quicktype "${sample}"`;
  },
  diffViaSchema: true,
  allowMissingNull: false,
  output: "quicktype.hpp",
  topLevel: "TopLevel",
  skipJSON: [
    // fails on a string containing null
    "nst-test-suite.json",
    // takes too long to compile
    "combinations.json"
  ],
  skipMiscJSON: false,
  skipSchema: [],
  rendererOptions: {},
  quickTestRendererOptions: [{ unions: "indirection" }],
  sourceFiles: ["src/Language/CPlusPlus.ts"]
};

export const ElmLanguage: Language = {
  name: "elm",
  base: "test/fixtures/elm",
  setupCommand: "rm -rf elm-stuff/build-artifacts && elm-make --yes",
  compileCommand: "elm-make Main.elm QuickType.elm --output elm.js",
  runCommand(sample: string) {
    return `node ./runner.js "${sample}"`;
  },
  diffViaSchema: true,
  allowMissingNull: false,
  output: "QuickType.elm",
  topLevel: "QuickType",
  skipJSON: [
    "identifiers.json",
    "simple-identifiers.json",
    "blns-object.json",
    "recursive.json",
    "direct-recursive.json",
    "bug427.json",
    "list.json",
    "nst-test-suite.json",
    "keywords.json" // stack overflow
  ],
  skipMiscJSON: false,
  skipSchema: [
    "union-list.schema", // recursion
    "list.schema", // recursion
    "mutually-recursive.schema", // recursion
    "keyword-unions.schema" // can't handle "hasOwnProperty" for some reason
  ],
  rendererOptions: {},
  quickTestRendererOptions: [{ "array-type": "list" }],
  sourceFiles: ["src/Language/Elm.ts"]
};

export const SwiftLanguage: Language = {
  name: "swift",
  base: "test/fixtures/swift",
  compileCommand: `swiftc -o quicktype main.swift quicktype.swift`,
  runCommand(sample: string) {
    return `./quicktype "${sample}"`;
  },
  diffViaSchema: true,
  allowMissingNull: true,
  output: "quicktype.swift",
  topLevel: "TopLevel",
  skipJSON: [
    // Swift only supports top-level arrays and objects
    "no-classes.json",
    // This at least is keeping blns-object from working: https://bugs.swift.org/browse/SR-6314
    "blns-object.json",
    // Doesn't seem to work on Linux, works on MacOS
    "nst-test-suite.json"
  ],
  skipMiscJSON: false,
  skipSchema: [],
  rendererOptions: {},
  quickTestRendererOptions: [
    { "struct-or-class": "class" },
    { density: "dense" },
    { density: "normal" }
  ],
  sourceFiles: ["src/Language/Swift.ts"]
};

export const ObjectiveCLanguage: Language = {
  name: "objective-c",
  base: "test/fixtures/objective-c",
  compileCommand: `clang -Werror -framework Foundation *.m -o test`,
  runCommand(sample: string) {
    return `cp "${sample}" sample.json && ./test sample.json`;
  },
  diffViaSchema: true,
  allowMissingNull: true,
  output: "QTTopLevel.m",
  topLevel: "QTTopLevel",
  skipJSON: [
    // Almost all strings work except any containing \u001b
    // See https://goo.gl/L8HfUP
    "blns-object.json",
    // NSJSONSerialization can read but not write top-level primitives
    "no-classes.json",
    // TODO
    "combinations.json",
    // Needs to distinguish between optional and null properties
    "optional-union.json",
    // Compile error
    "nst-test-suite.json"
  ],
  skipMiscJSON: false,
  skipSchema: [],
  rendererOptions: { functions: "true" },
  quickTestRendererOptions: [],
  sourceFiles: ["src/Language/Objective-C.ts"]
};

export const TypeScriptLanguage: Language = {
  name: "typescript",
  base: "test/fixtures/typescript",
  runCommand(sample: string) {
    // We have to unset TS_NODE_PROJECT because it gets set on the workers
    // to the root test/tsconfig.json
    return `TS_NODE_PROJECT= ts-node main.ts \"${sample}\"`;
  },
  // FIXME: enable once TypeScript supports unions
  diffViaSchema: false,
  allowMissingNull: false,
  output: "TopLevel.ts",
  topLevel: "TopLevel",
  skipJSON: [],
  skipMiscJSON: false,
  skipSchema: ["keyword-unions.schema"], // can't handle "constructor" property
  rendererOptions: { "explicit-unions": "yes" },
  quickTestRendererOptions: [],
  sourceFiles: ["src/Language/TypeScript.ts"]
};
