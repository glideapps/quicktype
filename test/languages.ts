import { RendererOptions } from "../dist/quicktype-core/Run";
import * as process from "process";

export interface Language {
  name: string;
  base: string;
  setupCommand?: string;
  compileCommand?: string;
  runCommand(sample: string): string;
  diffViaSchema: boolean;
  skipDiffViaSchema: string[];
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
  skipDiffViaSchema: ["bug427.json", "combinations.json", "keywords.json", "34702.json"],
  allowMissingNull: false,
  output: "QuickType.cs",
  topLevel: "TopLevel",
  skipJSON: [
    "nbl-stats.json", // See issue #823
    "empty-enum.json", // https://github.com/JamesNK/Newtonsoft.Json/issues/1687
    "31189.json" // JSON.NET doesn't accept year 0000 as 1BC, though it should
  ],
  skipMiscJSON: false,
  skipSchema: [
    "top-level-enum.schema" // The code we generate for top-level enums is incompatible with the driver
  ],
  rendererOptions: { "check-required": "true" },
  quickTestRendererOptions: [
    { "array-type": "list" },
    { "csharp-version": "5" },
    { density: "dense" },
    { "number-type": "decimal" },
    { "any-type": "dynamic" }
  ],
  sourceFiles: ["src/language/CSharp.ts"]
};

export const JavaLanguage: Language = {
  name: "java",
  base: "test/fixtures/java",
  setupCommand: "mvn package",
  compileCommand: "mvn package",
  runCommand(sample: string) {
    return `java -cp target/QuickTypeTest-1.0-SNAPSHOT.jar io.quicktype.App "${sample}"`;
  },
  // FIXME: implement comparing multiple files
  diffViaSchema: false,
  skipDiffViaSchema: [],
  allowMissingNull: false,
  output: "src/main/java/io/quicktype/TopLevel.java",
  topLevel: "TopLevel",
  skipJSON: ["identifiers.json", "simple-identifiers.json", "nst-test-suite.json"],
  skipMiscJSON: false,
  skipSchema: ["keyword-unions.schema"], // generates classes with names that are case-insensitively equal
  rendererOptions: {},
  quickTestRendererOptions: [],
  sourceFiles: ["src/language/Java.ts"]
};

export const RustLanguage: Language = {
  name: "rust",
  base: "test/fixtures/rust",
  setupCommand: "cargo build || true",
  compileCommand: "cargo build --jobs 1",
  runCommand(sample: string) {
    return `RUST_THREADS=1 ./target/debug/quick_type_test "${sample}"`;
  },
  diffViaSchema: true,
  skipDiffViaSchema: [
    "combinations.json",
    "bug427.json",
    "keywords.json",
    "recursive.json",
    "github-events.json",
    "0a91a.json",
    "0cffa.json",
    "127a1.json",
    "26b49.json",
    "34702.json",
    "7681c.json",
    "76ae1.json",
    "af2d1.json",
    "c3303.json",
    "f6a65.json"
  ],
  allowMissingNull: false,
  output: "module_under_test.rs",
  topLevel: "TopLevel",
  skipJSON: [],
  skipSchema: [],
  skipMiscJSON: false,
  rendererOptions: {},
  quickTestRendererOptions: [
    { density: "dense" },
    { visibility: "crate" },
    { visibility: "private" },
    { visibility: "public" }
  ],
  sourceFiles: ["src/language/Rust.ts"]
};

export const RubyLanguage: Language = {
  name: "ruby",
  base: "test/fixtures/ruby",
  setupCommand: "bundle install --path vendor/bundle",
  compileCommand: "true",
  runCommand(sample: string) {
    return `bundle exec main.rb "${sample}"`;
  },
  diffViaSchema: true,
  skipDiffViaSchema: [
    "keywords.json",
    "nst-test-suite.json",
    "recursive.json",
    "combinations.json",
    "bug427.json",
    "bug863.json",
    "kitchen-sink.json",
    "github-events.json",
    "nbl-stats.json",
    "reddit.json",
    "00c36.json",
    "050b0.json",
    "06bee.json",
    "07c75.json",
    "0a91a.json",
    "10be4.json",
    "27332.json",
    "29f47.json",
    "2df80.json",
    "3536b.json",
    "34702.json",
    "33d2e.json",
    "43970.json",
    "4a455.json",
    "570ec.json",
    "4d6fb.json",
    "66121.json",
    "65dec.json",
    "6eb00.json",
    "6de06.json",
    "7fbfb.json",
    "76ae1.json",
    "8592b.json",
    "9847b.json",
    "9a503.json",
    "996bd.json",
    "9eed5.json",
    "ad8be.json",
    "ae7f0.json",
    "af2d1.json",
    "b4865.json",
    "be234.json",
    "c8c7e.json",
    "cda6c.json",
    "dc44f.json",
    "dd1ce.json",
    "e53b5.json",
    "f22f5.json",
    "f3139.json",
    "e8b04.json"
  ],
  allowMissingNull: true,
  output: "TopLevel.rb",
  topLevel: "TopLevel",
  skipJSON: [],
  skipSchema: [
    // FIXME: I don't know what the issue is here
    "implicit-class-array-union.schema",
    // We don't generate a convenience method for top-level enums
    "top-level-enum.schema"
  ],
  skipMiscJSON: false,
  rendererOptions: {},
  quickTestRendererOptions: [],
  sourceFiles: ["src/language/ruby/index.ts"]
};

export const GoLanguage: Language = {
  name: "golang",
  base: "test/fixtures/golang",
  runCommand(sample: string) {
    return `go run main.go quicktype.go < "${sample}"`;
  },
  diffViaSchema: true,
  skipDiffViaSchema: [
    "combinations.json",
    "bug427.json",
    "bug863.json",
    "github-events.json",
    "reddit.json",
    "nbl-stats.json",
    "recursive.json",
    "0cffa.json",
    "0e0c2.json",
    "127a1.json",
    "26b49.json",
    "29f47.json",
    "2df80.json",
    "32431.json",
    "27332.json",
    "337ed.json",
    "34702.json",
    "4a455.json",
    "6de06.json",
    "7eb30.json",
    "7681c.json",
    "76ae1.json",
    "ae9ca.json",
    "af2d1.json",
    "be234.json",
    "c3303.json",
    "e8b04.json",
    "f6a65.json"
  ],
  allowMissingNull: false,
  output: "quicktype.go",
  topLevel: "TopLevel",
  skipJSON: ["identifiers.json", "simple-identifiers.json", "blns-object.json", "nst-test-suite.json"],
  skipMiscJSON: false,
  skipSchema: [
    // interface{} as top-level doesn't work
    "any.schema"
  ],
  rendererOptions: {},
  quickTestRendererOptions: [],
  sourceFiles: ["src/language/Golang.ts"]
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
  skipDiffViaSchema: [
    "github-events.json",
    "combinations.json",
    "bug427.json",
    "keywords.json",
    "0a91a.json",
    "0cffa.json",
    "127a1.json",
    "26b49.json",
    "34702.json",
    "7681c.json",
    "7f568.json",
    "c3303.json",
    "e8b04.json",
    "f6a65.json",
    "fcca3.json"
  ],
  allowMissingNull: false,
  output: "quicktype.hpp",
  topLevel: "TopLevel",
  skipJSON: [
    // fails on a string containing null
    "nst-test-suite.json",
    // compiler error I don't want to figure out right now
    "nbl-stats.json"
  ],
  skipMiscJSON: false,
  skipSchema: [],
  rendererOptions: {},
  quickTestRendererOptions: [{ unions: "indirection" }],
  sourceFiles: ["src/language/CPlusPlus.ts"]
};

export const ElmLanguage: Language = {
  name: "elm",
  base: "test/fixtures/elm",
  setupCommand: "rm -rf elm-stuff/build-artifacts && elm-make --yes",
  compileCommand:
    process.env.CI === "true"
      ? "sysconfcpus -n 1 elm-make Main.elm QuickType.elm --output elm.js"
      : "elm-make Main.elm QuickType.elm --output elm.js",
  runCommand(sample: string) {
    return `node ./runner.js "${sample}"`;
  },
  diffViaSchema: true,
  skipDiffViaSchema: [
    "bug863.json",
    "reddit.json",
    "github-events.json",
    "nbl-stats.json",
    "0a91a.json",
    "0cffa.json",
    "0e0c2.json",
    "127a1.json",
    "29f47.json",
    "2df80.json",
    "27332.json",
    "32431.json",
    "337ed.json",
    "34702.json",
    "4a455.json",
    "6de06.json",
    "76ae1.json",
    "7eb30.json",
    "7681c.json",
    "ae9ca.json",
    "af2d1.json",
    "be234.json",
    "c3303.json",
    "e8b04.json",
    "f6a65.json"
  ],
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
    "bug790.json",
    "list.json",
    "nst-test-suite.json",
    "keywords.json" // stack overflow
  ],
  skipMiscJSON: false,
  skipSchema: [
    "union-list.schema", // recursion
    "list.schema", // recursion
    "mutually-recursive.schema", // recursion
    "postman-collection.schema", // recursion
    "vega-lite.schema", // recursion
    "simple-ref.schema", // recursion
    "keyword-unions.schema" // can't handle "hasOwnProperty" for some reason
  ],
  rendererOptions: {},
  quickTestRendererOptions: [{ "array-type": "list" }],
  sourceFiles: ["src/language/Elm.ts"]
};

export const SwiftLanguage: Language = {
  name: "swift",
  base: "test/fixtures/swift",
  compileCommand: `swiftc -o quicktype main.swift quicktype.swift`,
  runCommand(sample: string) {
    return `./quicktype "${sample}"`;
  },
  diffViaSchema: true,
  skipDiffViaSchema: [
    "bug427.json",
    "github-events.json",
    "keywords.json",
    "0a91a.json",
    "337ed.json",
    "34702.json",
    "7f568.json",
    "734ad.json",
    "76ae1.json",
    "c8c7e.json",
    "e53b5.json",
    "e8b04.json",
    "fcca3.json",
    "f82d9.json"
  ],
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
  skipSchema: [
    // The top-level is anything, which Swift's JSON types don't support
    "any.schema",
    // The top-level is a union, which Swift's JSON types don't support
    "implicit-class-array-union.schema",
    // The code we generate for top-level enums is incompatible with the driver
    "top-level-enum.schema"
  ],
  rendererOptions: {},
  quickTestRendererOptions: [
    { "struct-or-class": "class" },
    { density: "dense" },
    { density: "normal" },
    { "url-session": "true" },
    { "access-level": "internal" },
    { "access-level": "public" }
  ],
  sourceFiles: ["src/language/Swift.ts"]
};

export const ObjectiveCLanguage: Language = {
  name: "objective-c",
  base: "test/fixtures/objective-c",
  compileCommand: `clang -Werror -framework Foundation *.m -o test`,
  runCommand(sample: string) {
    return `cp "${sample}" sample.json && ./test sample.json`;
  },
  diffViaSchema: false,
  skipDiffViaSchema: [],
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
  sourceFiles: ["src/language/Objective-C.ts"]
};

export const TypeScriptLanguage: Language = {
  name: "typescript",
  base: "test/fixtures/typescript",
  runCommand(sample: string) {
    // We have to unset TS_NODE_PROJECT because it gets set on the workers
    // to the root test/tsconfig.json
    return `TS_NODE_PROJECT= ts-node main.ts \"${sample}\"`;
  },
  diffViaSchema: true,
  skipDiffViaSchema: [
    "bug427.json",
    "bug863.json",
    "kitchen-sink.json",
    "nbl-stats.json",
    "00c36.json",
    "2df80.json",
    "34702.json",
    "76ae1.json",
    "7fbfb.json",
    "c8c7e.json",
    "cda6c.json",
    "e53b5.json",
    "e8b04.json"
  ],
  allowMissingNull: false,
  output: "TopLevel.ts",
  topLevel: "TopLevel",
  skipJSON: [],
  skipMiscJSON: false,
  skipSchema: ["keyword-unions.schema"], // can't handle "constructor" property
  rendererOptions: { "explicit-unions": "yes" },
  quickTestRendererOptions: [],
  sourceFiles: ["src/language/TypeScript.ts"]
};

export const JavaScriptLanguage: Language = {
  name: "javascript",
  base: "test/fixtures/javascript",
  runCommand(sample: string) {
    return `node main.js \"${sample}\"`;
  },
  // FIXME: enable once TypeScript supports unions
  diffViaSchema: false,
  skipDiffViaSchema: [],
  allowMissingNull: false,
  output: "TopLevel.js",
  topLevel: "TopLevel",
  skipJSON: [],
  skipMiscJSON: false,
  skipSchema: ["keyword-unions.schema"], // can't handle "constructor" property
  rendererOptions: {},
  quickTestRendererOptions: [],
  sourceFiles: ["src/language/JavaScript.ts"]
};

export const FlowLanguage: Language = {
  name: "flow",
  base: "test/fixtures/flow",
  runCommand(sample: string) {
    return `flow check 1>&2 && flow-node main.js \"${sample}\"`;
  },
  diffViaSchema: false,
  skipDiffViaSchema: [],
  allowMissingNull: false,
  output: "TopLevel.js",
  topLevel: "TopLevel",
  skipJSON: [],
  skipMiscJSON: false,
  skipSchema: [
    "keyword-unions.schema" // can't handle "constructor" property
  ],
  rendererOptions: { "explicit-unions": "yes" },
  quickTestRendererOptions: [],
  sourceFiles: ["src/language/Flow.ts"]
};

export const KotlinLanguage: Language = {
  name: "kotlin",
  base: "test/fixtures/kotlin",
  compileCommand: "./build.sh",
  runCommand(sample: string) {
    return `cp "${sample}" sample.json && ./run.sh`;
  },
  diffViaSchema: true,
  skipDiffViaSchema: [
    "bug427.json",
    "keywords.json",
    // TODO Investigate these
    "34702.json",
    "76ae1.json"
  ],
  allowMissingNull: true,
  output: "TopLevel.kt",
  topLevel: "TopLevel",
  skipJSON: [
    // Some odd property names prevent Klaxon from mapping to constructors
    // https://github.com/cbeust/klaxon/issues/146
    "blns-object.json",
    "identifiers.json",
    "simple-identifiers.json",
    // Klaxon cannot parse List<List<Enum | Union>>
    // https://github.com/cbeust/klaxon/issues/145
    "kitchen-sink.json",
    "26c9c.json",
    "421d4.json",
    "a0496.json",
    "fcca3.json",
    "ae9ca.json",
    "617e8.json",
    "5f7fe.json",
    "f74d5.json",
    "a3d8c.json",
    // Klaxon has a hard time with null inside collections
    "combinations.json",
    "unions.json",
    "nst-test-suite.json",
    // Klaxon does not support top-level primitives
    "no-classes.json",
    // These should be enabled
    "nbl-stats.json",
    // TODO Investigate these
    "af2d1.json",
    "32431.json",
    "bug427.json"
  ],
  skipSchema: [],
  skipMiscJSON: false,
  rendererOptions: {},
  quickTestRendererOptions: [],
  sourceFiles: ["src/Language/Kotlin.ts"]
};
