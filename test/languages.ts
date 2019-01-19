import { RendererOptions } from "../dist/quicktype-core/Run";
import * as process from "process";

export type LanguageFeature =
  | "enum"
  | "union"
  | "no-defaults"
  | "strict-optional"
  | "date-time"
  | "integer-string"
  | "bool-string"
  | "uuid"
  | "minmax"
  | "minmaxlength"
  | "pattern";

export interface Language {
  name: string;
  base: string;
  setupCommand?: string;
  compileCommand?: string;
  runCommand?: (sample: string) => string;
  diffViaSchema: boolean;
  skipDiffViaSchema: string[];
  allowMissingNull: boolean;
  features: LanguageFeature[];
  output: string;
  topLevel: string;
  skipJSON: string[];
  skipMiscJSON: boolean;
  skipSchema: string[];
  rendererOptions: RendererOptions;
  quickTestRendererOptions: (RendererOptions | [string, RendererOptions])[];
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
  skipDiffViaSchema: ["34702.json", "437e7.json"],
  allowMissingNull: false,
  features: [
    "enum",
    "union",
    "no-defaults",
    "strict-optional",
    "date-time",
    "integer-string",
    "bool-string",
    "uuid"
  ],
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
  features: ["enum", "union"],
  output: "src/main/java/io/quicktype/TopLevel.java",
  topLevel: "TopLevel",
  skipJSON: ["identifiers.json", "simple-identifiers.json", "nst-test-suite.json"],
  skipMiscJSON: false,
  skipSchema: ["keyword-unions.schema"], // generates classes with names that are case-insensitively equal
  rendererOptions: {},
  quickTestRendererOptions: [],
  sourceFiles: ["src/language/Java.ts"]
};

export const PythonLanguage: Language = {
  name: "python",
  base: "test/fixtures/python",
  compileCommand: "mypy quicktype.py",
  runCommand(sample: String) {
    return `./run.sh main.py "${sample}"`;
  },
  diffViaSchema: true,
  skipDiffViaSchema: [
    "keywords.json",
    "0cffa.json",
    "127a1.json",
    "26b49.json",
    "34702.json",
    "7681c.json",
    "c3303.json",
    "e8b04.json",
    "f6a65.json"
  ],
  allowMissingNull: false,
  features: ["enum", "union", "no-defaults", "date-time", "integer-string", "bool-string", "uuid"],
  output: "quicktype.py",
  topLevel: "TopLevel",
  skipJSON: [
    "31189.json" // year 0 is out of range
  ],
  skipMiscJSON: false,
  skipSchema: [
    "keyword-unions.schema" // Requires more than 255 arguments
  ],
  rendererOptions: {},
  quickTestRendererOptions: [{ "python-version": "3.5" }, { "python-version": "2.7" }],
  sourceFiles: ["src/language/Python.ts"]
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
    "bug427.json",
    "keywords.json",
    "recursive.json",
    "github-events.json",
    "nst-test-suite.json",
    "0a91a.json",
    "0cffa.json",
    "127a1.json",
    "26b49.json",
    "34702.json",
    "7681c.json",
    "76ae1.json",
    "af2d1.json",
    "c3303.json",
    "e8b04.json",
    "f6a65.json"
  ],
  allowMissingNull: false,
  features: ["enum", "union", "no-defaults"],
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

export const CrystalLanguage: Language = {
  name: "crystal",
  base: "test/fixtures/crystal",
  compileCommand: "crystal build -o quicktype main.cr",
  runCommand(sample: string) {
    return `./quicktype "${sample}"`;
  },
  diffViaSchema: false,
  skipDiffViaSchema: [],
  allowMissingNull: true,
  features: ["enum", "union", "no-defaults"],
  output: "TopLevel.cr",
  topLevel: "TopLevel",
  skipJSON: [
    "blns-object.json",
    "identifiers.json",
    "simple-identifiers.json",
    "bug427.json",
    "nst-test-suite.json",
    "34702.json",
    "34702.json",
    "4961a.json",
    "32431.json",
    "68c30.json",
    "e8b04.json"
  ],
  skipSchema: [
    // Crystal does not handle enum mapping
    "enum.schema",
    // Crystal does not support top-level primitives
    "top-level-enum.schema",
    "keyword-unions.schema"
  ],
  skipMiscJSON: false,
  rendererOptions: {},
  quickTestRendererOptions: [],
  sourceFiles: ["src/language/Crystal.ts"]
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
    "combinations3.json",
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
  features: ["enum", "union", "no-defaults"],
  output: "TopLevel.rb",
  topLevel: "TopLevel",
  skipJSON: [],
  skipSchema: [
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
    "bug427.json",
    "nbl-stats.json",
    "0e0c2.json",
    "2df80.json",
    "337ed.json",
    "34702.json",
    "7eb30.json",
    "e8b04.json"
  ],
  allowMissingNull: false,
  features: ["union"],
  output: "quicktype.go",
  topLevel: "TopLevel",
  skipJSON: ["identifiers.json", "simple-identifiers.json", "blns-object.json", "nst-test-suite.json"],
  skipMiscJSON: false,
  skipSchema: [],
  rendererOptions: {},
  quickTestRendererOptions: [],
  sourceFiles: ["src/language/Golang.ts"]
};

export const CPlusPlusLanguage: Language = {
  name: "cplusplus",
  base: "test/fixtures/cplusplus",
  setupCommand:
    "curl -o json.hpp https://raw.githubusercontent.com/nlohmann/json/87df1d6708915ffbfa26a051ad7562ecc22e5579/src/json.hpp",
  compileCommand: "g++ -O0 -o quicktype -std=c++17 main.cpp",
  runCommand(sample: string) {
    return `./quicktype "${sample}"`;
  },
  diffViaSchema: true,
  skipDiffViaSchema: [
    "github-events.json",
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
  features: ["minmax", "minmaxlength", "pattern", "enum", "union", "no-defaults"],
  output: "TopLevel.hpp",
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
  quickTestRendererOptions: [
    { unions: "indirection" },
    { "source-style": "multi-source" },
    { "code-format": "with-struct" },
    { wstring: "use-wstring" },
    { "const-style": "east-const" },
    { boost: "false" }
  ],
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
  features: ["enum", "union", "no-defaults"],
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
    "constructor.schema", // can't handle "constructor" property
    "union-list.schema", // recursion
    "list.schema", // recursion
    "ref-remote.schema", // recursion
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
    "0a358.json", // date-time issues
    "0a91a.json",
    "0cffa.json", // date-time issues
    "127a1.json", // date-time issues
    "26b49.json", // date-time issues
    "26c9c.json", // uri/string confusion
    "32d5c.json", // date-time issues
    "337ed.json",
    "34702.json",
    "437e7.json", // date-time issues
    "54d32.json", // date-time issues
    "5eae5.json", // date-time issues
    "7681c.json", // date-time issues
    "77392.json", // date-time issues
    "7f568.json",
    "734ad.json",
    "76ae1.json",
    "80aff.json", // date-time issues
    "9ac3b.json", // date-time issues
    "a0496.json", // date-time issues
    "b4865.json", // date-time issues
    "c3303.json", // date-time issues
    "c8c7e.json",
    "d23d5.json", // date-time issues
    "e0ac7.json", // date-time issues
    "e53b5.json",
    "e8b04.json",
    "f6a65.json", // date-time issues
    "fcca3.json",
    "f82d9.json"
  ],
  allowMissingNull: true,
  features: ["enum", "union", "no-defaults", "date-time"],
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
    // The code we generate for top-level enums is incompatible with the driver
    "top-level-enum.schema",
    // This works on macOS, but on Linux one of the failure test cases doesn't fail
    "implicit-class-array-union.schema"
  ],
  rendererOptions: { "support-linux": "true" },
  quickTestRendererOptions: [
    { "support-linux": "false" },
    { "struct-or-class": "class" },
    { density: "dense" },
    { density: "normal" },
    { "url-session": "true" },
    { "access-level": "internal" },
    { "access-level": "public" },
    { protocol: "equatable" },
    ["simple-object.json", { protocol: "hashable" }]
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
  features: ["enum", "no-defaults"],
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
    "nst-test-suite.json",
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
  features: ["enum", "union", "no-defaults", "strict-optional"],
  output: "TopLevel.ts",
  topLevel: "TopLevel",
  skipJSON: [],
  skipMiscJSON: false,
  skipSchema: ["keyword-unions.schema"], // can't handle "constructor" property
  rendererOptions: { "explicit-unions": "yes" },
  quickTestRendererOptions: [
    { "runtime-typecheck": "false" },
    { "nice-property-names": "true" },
    { "declare-unions": "true" },
    { "acronym-style": "pascal" }
  ],
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
  features: ["enum", "union", "no-defaults", "strict-optional"],
  output: "TopLevel.js",
  topLevel: "TopLevel",
  skipJSON: [],
  skipMiscJSON: false,
  skipSchema: ["keyword-unions.schema"], // can't handle "constructor" property
  rendererOptions: {},
  quickTestRendererOptions: [{ "runtime-typecheck": "false" }],
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
  features: ["enum", "union", "no-defaults", "strict-optional"],
  output: "TopLevel.js",
  topLevel: "TopLevel",
  skipJSON: [],
  skipMiscJSON: false,
  skipSchema: [
    "keyword-unions.schema" // can't handle "constructor" property
  ],
  rendererOptions: { "explicit-unions": "yes" },
  quickTestRendererOptions: [
    { "runtime-typecheck": "false" },
    { "nice-property-names": "true" },
    { "declare-unions": "true" }
  ],
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
  features: ["enum", "union", "no-defaults"],
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
    "combinations1.json",
    "combinations2.json",
    "combinations3.json",
    "combinations4.json",
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
  skipSchema: [
    // Very weird - the types are correct, but it can (de)serialize the string,
    // which is not represented in the types.
    "class-with-additional.schema",
    "implicit-class-array-union.schema",
    "go-schema-pattern-properties.schema",
    // IllegalArgumentException
    "accessors.schema",
    "description.schema",
    "union-list.schema",
    // KlaxonException: Need to extract inside
    "bool-string.schema",
    "integer-string.schema",
    "uuid.schema",
    // produces {"foo" : "java.lang.Object@48d61b48"}
    "any.schema",
    // KlaxonException: Couldn't find a suitable constructor for class UnionValue to initialize with {}
    "class-map-union.schema",
    "direct-union.schema",
    // Some weird name collision
    "keyword-enum.schema",
    "keyword-unions.schema",
    // Klaxon does not support top-level primitives
    "top-level-enum.schema"
  ],
  skipMiscJSON: false,
  rendererOptions: {},
  quickTestRendererOptions: [],
  sourceFiles: ["src/Language/Kotlin.ts"]
};

export const KotlinJacksonLanguage: Language = {
  name: "kotlin",
  base: "test/fixtures/kotlin-jackson",
  compileCommand: "./build.sh",
  runCommand(sample: string) {
    return `./run.sh "${sample}"`;
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
  features: ["enum", "union", "no-defaults"],
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
    "combinations1.json",
    "combinations2.json",
    "combinations3.json",
    "combinations4.json",
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
  skipSchema: [
    // Very weird - the types are correct, but it can (de)serialize the string,
    // which is not represented in the types.
    "class-with-additional.schema",
    "implicit-class-array-union.schema",
    "go-schema-pattern-properties.schema",
    // IllegalArgumentException
    "accessors.schema",
    "description.schema",
    "union-list.schema",
    // KlaxonException: Need to extract inside
    "bool-string.schema",
    "integer-string.schema",
    "uuid.schema",
    // produces {"foo" : "java.lang.Object@48d61b48"}
    "any.schema",
    // KlaxonException: Couldn't find a suitable constructor for class UnionValue to initialize with {}
    "class-map-union.schema",
    "direct-union.schema",
    // Some weird name collision
    "keyword-enum.schema",
    "keyword-unions.schema",
    // Klaxon does not support top-level primitives
    "top-level-enum.schema"
  ],
  skipMiscJSON: false,
  rendererOptions: { framework: "jackson" },
  quickTestRendererOptions: [],
  sourceFiles: ["src/Language/Kotlin.ts"]
};

export const DartLanguage: Language = {
  name: "dart",
  base: "test/fixtures/dart",
  runCommand(sample: string) {
    return `dart parser.dart \"${sample}\"`;
  },
  diffViaSchema: false,
  skipDiffViaSchema: [],
  allowMissingNull: true,
  features: [],
  output: "TopLevel.dart",
  topLevel: "TopLevel",
  skipJSON: [],
  skipSchema: [],
  skipMiscJSON: false,
  rendererOptions: {},
  quickTestRendererOptions: [],
  sourceFiles: ["src/Language/Dart.ts"]
};

export const PikeLanguage: Language = {
  name: "pike",
  base: "test/fixtures/pike",
  runCommand(sample: string) {
    return `pike main.pike \"${sample}\"`;
  },
  diffViaSchema: false,
  skipDiffViaSchema: [],
  allowMissingNull: true,
  features: ["union"],
  output: "TopLevel.pmod",
  topLevel: "TopLevel",
  skipJSON: [
    "blns-object.json", // illegal characters in expressions
    "identifiers.json", // quicktype internal error
    "7eb30.json", // illegal characters in expressions
    "c6cfd.json", // illegal characters in values
    // all below: Pike's Stdio.File.write() does not support wide strings.
    "nst-test-suite.json",
    "0b91a.json",
    "29f47.json",
    "337ed.json",
    "33d2e.json",
    "458db.json",
    "6c155.json",
    "6de06.json",
    "734ad.json",
    "8592b.json",
    "9ac3b.json",
    "cb0cc.json",
    "d23d5.json",
    "dc44f.json",
    "dec3a.json",
    "f22f5.json",
    "f22f5.json"
  ],
  skipMiscJSON: false,
  skipSchema: [
    "top-level-enum.schema", // output generated properly, but not a class
    "keyword-unions.schema", // seems like a problem with deserializing
    "integer-float-union.schema", // no implicit cast int <-> float in Pike
    "minmax.schema", // no implicit cast int <-> float in Pike
    // all below: not failing on expected failure. That's because Pike's quite tolerant with assignments.
    "go-schema-pattern-properties.schema",
    "class-with-additional.schema",
    "multi-type-enum.schema",
    "class-map-union.schema",
    "implicit-class-array-union.schema"
  ],
  rendererOptions: {},
  quickTestRendererOptions: [],
  sourceFiles: ["src/Language/Pike.ts"]
};
