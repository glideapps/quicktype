import * as process from "process";
// @ts-ignore
import { RendererOptions } from "../dist/quicktype-core/Run";

const easySampleJSONs = ["bitcoin-block.json", "pokedex.json", "simple-object.json", "getting-started.json"];

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
    copyInput?: boolean;
    diffViaSchema: boolean;
    skipDiffViaSchema: string[];
    allowMissingNull: boolean;
    features: LanguageFeature[];
    output: string;
    topLevel: string;
    skipJSON?: string[];
    includeJSON?: string[];
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
    setupCommand: "dotnet restore -p:CheckEolTargetFramework=false --no-cache",
    runCommand(sample: string) {
        return `dotnet run -p:CheckEolTargetFramework=false -- "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: ["34702.json", "437e7.json"],
    allowMissingNull: false,
    features: ["enum", "union", "no-defaults", "strict-optional", "date-time", "integer-string", "bool-string", "uuid"],
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

export const CSharpLanguageSystemTextJson: Language = {
    name: "csharp",
    base: "test/fixtures/csharp-SystemTextJson",
    // https://github.com/dotnet/cli/issues/1582
    setupCommand: "dotnet restore --no-cache",
    runCommand(sample: string) {
        return `dotnet run -- "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: ["34702.json", "437e7.json"],
    allowMissingNull: false,
    features: ["enum", "union", "no-defaults", "strict-optional", "date-time", "integer-string", "bool-string", "uuid"],
    output: "QuickType.cs",
    topLevel: "TopLevel",
    skipJSON: [
        "31189.json" // .NET doesn't accept year 0000 as 1BC, though it should
    ],
    skipMiscJSON: false,
    skipSchema: [
        "top-level-enum.schema" // The code we generate for top-level enums is incompatible with the driver
    ],
    rendererOptions: { "check-required": "true", framework: "SystemTextJson" },
    quickTestRendererOptions: [
        { "array-type": "list" },
        { "csharp-version": "6" },
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
    features: ["enum", "union", "uuid"],
    output: "src/main/java/io/quicktype/TopLevel.java",
    topLevel: "TopLevel",
    skipJSON: ["identifiers.json", "simple-identifiers.json", "nst-test-suite.json"],
    skipMiscJSON: false,
    skipSchema: ["keyword-unions.schema"], // generates classes with names that are case-insensitively equal
    rendererOptions: {},
    quickTestRendererOptions: [{ "array-type": "list" }],
    sourceFiles: ["src/language/Java.ts"]
};

export const JavaLanguageWithLegacyDateTime: Language = {
    ...JavaLanguage,
    skipSchema: [
        ...JavaLanguage.skipSchema,
        "date-time.schema" // Expects less strict serialization.
    ],
    skipJSON: [
        ...(JavaLanguage.skipJSON !== undefined ? JavaLanguage.skipJSON : []),
        "0a358.json", // Expects less strict serialization (optional milliseconds).
        "337ed.json" // Expects less strict serialization (optional milliseconds).
    ],
    skipMiscJSON: true, // Handles edge cases differently and does not allow optional milliseconds.
    rendererOptions: { "datetime-provider": "legacy" },
    quickTestRendererOptions: [{ "array-type": "list" }]
};

export const JavaLanguageWithLombok: Language = {
    ...JavaLanguage,
    base: "test/fixtures/java-lombok",
    quickTestRendererOptions: [{ "array-type": "list", lombok: "true" }]
};

export const PythonLanguage: Language = {
    name: "python",
    base: "test/fixtures/python",
    compileCommand: "mypy quicktype.py",
    runCommand(sample: string) {
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
    allowMissingNull: true,
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
    quickTestRendererOptions: [{ "python-version": "3.5" }],
    sourceFiles: ["src/language/Python.ts"]
};

export const RustLanguage: Language = {
    name: "rust",
    base: "test/fixtures/rust",
    runCommand(sample: string) {
        return `RUST_THREADS=1 cargo run --jobs 1 -- "${sample}"`;
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
    setupCommand: "bundle install",
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
    skipJSON: [
        // Chokes on { "1": "one" } because _[0-9]+ is reserved in ruby
        "blns-object.json",
        // Ruby union code does not work with new Dry
        // can't convert Symbol into Hash (Dry::Types::CoercionError)
        "bug863.json",
        "combinations1.json",
        "combinations2.json",
        "combinations3.json",
        "combinations4.json",
        "nst-test-suite.json",
        "optional-union.json",
        "union-constructor-clash.json",
        "unions.json",
        "nbl-stats.json",
        "kitchen-sink.json"
    ],
    skipSchema: [
        // We don't generate a convenience method for top-level enums
        "top-level-enum.schema"
    ],
    skipMiscJSON: false,
    rendererOptions: {},
    quickTestRendererOptions: [["pokedex.json", { namespace: "QuickType" }]],
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
    skipJSON: [
        "identifiers.json",
        "simple-identifiers.json",
        "blns-object.json",
        "nst-test-suite.json",
        // can't differenciate empty array and nothing for optional empty array
        // (omitempty).
        "github-events.json",
        // files contains datetime filed with contain non rfc3339 format value
        "f6a65.json",
        "e0ac7.json",
        "c3303.json",
        "7681c.json",
        "437e7.json",
        "127a1.json",
        "26b49.json",
        "0cffa.json"
    ],
    skipMiscJSON: false,
    skipSchema: [
        // can't differenciate empty array and nothing for optional empty array
        // (omitempty).
        "postman-collection.schema"
    ],
    rendererOptions: {},
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/Golang.ts"]
};

export const CJSONLanguage: Language = {
    name: "cjson",
    base: "test/fixtures/cjson",
    setupCommand:
        "curl -o cJSON.c https://raw.githubusercontent.com/DaveGamble/cJSON/v1.7.15/cJSON.c && curl -o cJSON.h https://raw.githubusercontent.com/DaveGamble/cJSON/v1.7.15/cJSON.h && curl -o list.h https://raw.githubusercontent.com/joelguittet/c-list/master/include/list.h && curl -o list.c https://raw.githubusercontent.com/joelguittet/c-list/master/src/list.c && curl -o hashtable.h https://raw.githubusercontent.com/joelguittet/c-hashtable/master/include/hashtable.h && curl -o hashtable.c https://raw.githubusercontent.com/joelguittet/c-hashtable/master/src/hashtable.c",
    compileCommand: "gcc -O0 -o quicktype -I. cJSON.c hashtable.c list.c main.c -lpthread",
    runCommand(sample: string) {
        return `valgrind --leak-check=full --show-leak-kinds=all --track-origins=yes --error-exitcode=1 ./quicktype "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [
        /* Enum constants are different when generating with schema */
        "34702.json",
        /* Member names are different when generating with schema */
        "0a91a.json",
        "7f568.json",
        "e8b04.json",
        "fcca3.json",
        "bug427.json",
        "github-events.json",
        "keywords.json"
    ],
    allowMissingNull: false,
    features: ["minmax", "minmaxlength", "pattern", "enum", "union", "no-defaults"],
    output: "TopLevel.h",
    topLevel: "TopLevel",
    skipJSON: [
        /* Line feed in identifiers is not supported */
        "identifiers.json",
        /* Quote in identifier is not supported */
        "blns-object.json",
        "simple-identifiers.json",
        /* cJSON is not able to parse input with special characters */
        "nst-test-suite.json",
        /* Union with no name in nullable Array in Array is not supported */
        "combinations1.json",
        "combinations3.json",
        /* Map in Array in TopLevel is not supported (for the current implementation, can be added later, need recursivity) */
        "combinations2.json",
        /* Array in Array in Union is not supported (for the current implementation, can be added later, need recursivity) */
        "combinations4.json"
    ],
    skipMiscJSON: false,
    skipSchema: [
        /* Member names are different when generating with schema */
        "vega-lite.schema",
        /* Enum as TopLevel is not supported */
        "top-level-enum.schema",
        /* Union with Number and Integer are not supported */
        "integer-float-union.schema",
        /* Enum with invalid values are not checked (for the current implementation, can be added later, should abord parsing and return NULL) */
        "enum.schema",
        /* Union, Map and Arrays with invalid types are not checked (for the current implementation, can be added later, should abord parsing and return NULL) */
        "class-with-additional.schema",
        "go-schema-pattern-properties.schema",
        "multi-type-enum.schema",
        /* Class elements with invalid type are not checked (for the current implementation, can be added later, should abord parsing and return NULL) */
        "class-map-union.schema",
        /* Constraints (min/max and regex) are not supported (for the current implementation, can be added later, should abord parsing and return NULL) */
        "minmaxlength.schema",
        "minmax.schema",
        "pattern.schema",
        /* Required properties absent are not checked (for the current implementation, can be added later, should abord parsing and return NULL) */
        "intersection.schema",
        "required.schema",
        /* Pure Any type not supported (for the current implementation, can be added later, should manage a callback to provide the final application a way to handle it at parsing and creation of cJSON) */
        "any.schema",
        "direct-union.schema",
        "optional-any.schema",
        "required-non-properties.schema",
        /* Other cases not supported */
        "implicit-class-array-union.schema"
    ],
    rendererOptions: {},
    quickTestRendererOptions: [{ "source-style": "single-source" }],
    sourceFiles: ["src/language/CJSON.ts"]
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
        "nbl-stats.json",
        // uses too much memory compiling
        "combinations.json",
        "combinations1.json",
        "combinations2.json",
        "combinations3.json",
        "combinations4.json"
    ],
    skipMiscJSON: false,
    skipSchema: [
        // uses too much memory
        "keyword-unions.schema"
    ],
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
        "f82d9.json",
        "bug863.json" // Unable to resolve reserved keyword use, "description"
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
        "nst-test-suite.json",
        "null-safe.json"
    ],
    skipMiscJSON: false,
    skipSchema: [
        // The code we generate for top-level enums is incompatible with the driver
        "top-level-enum.schema",
        // This works on macOS, but on Linux one of the failure test cases doesn't fail
        "implicit-class-array-union.schema",
        "required.schema",
        "multi-type-enum.schema",
        "intersection.schema",
        "go-schema-pattern-properties.schema",
        "enum.schema",
        "date-time.schema",
        "class-with-additional.schema",
        "class-map-union.schema",
        "vega-lite.schema"
    ],
    rendererOptions: { "support-linux": "true" },
    quickTestRendererOptions: [
        { "support-linux": "false" },
        { "struct-or-class": "class" },
        { density: "dense" },
        { density: "normal" },
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
        "combinations1.json",
        // Needs to distinguish between optional and null properties
        "optional-union.json",
        // Compile error
        "nst-test-suite.json",
        // Could not convert JSON to model: Error Domain=JSONSerialization Code=-1 "(null)" UserInfo={exception=-[NSNull countByEnumeratingWithState:objects:count:]: unrecognized selector sent to instance 0x7fff807b6ea0}
        "combinations2.json",
        "combinations3.json",
        "combinations4.json"
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
    features: ["enum", "union", "no-defaults", "strict-optional", "date-time"],
    output: "TopLevel.ts",
    topLevel: "TopLevel",
    skipJSON: [
        "7681c.json" // year 0 is out of range
    ],
    skipMiscJSON: false,
    skipSchema: ["keyword-unions.schema"], // can't handle "constructor" property
    rendererOptions: { "explicit-unions": "yes" },
    quickTestRendererOptions: [
        { "runtime-typecheck": "false" },
        { "runtime-typecheck-ignore-unknown-properties": "true" },
        { "nice-property-names": "true" },
        { "declare-unions": "true" },
        ["pokedex.json", { "prefer-types": "true" }],
        { "acronym-style": "pascal" },
        { converters: "all-objects" }
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
    features: ["enum", "union", "no-defaults", "strict-optional", "date-time"],
    output: "TopLevel.js",
    topLevel: "TopLevel",
    skipJSON: [
        "7681c.json" // year 0 is out of range
    ],
    skipMiscJSON: false,
    skipSchema: ["keyword-unions.schema"], // can't handle "constructor" property
    rendererOptions: {},
    quickTestRendererOptions: [
        { "runtime-typecheck": "false" },
        { "runtime-typecheck-ignore-unknown-properties": "true" },
        { converters: "top-level" }
    ],
    sourceFiles: ["src/language/JavaScript.ts"]
};

export const JavaScriptPropTypesLanguage: Language = {
    name: "javascript-prop-types",
    base: "test/fixtures/javascript-prop-types",
    setupCommand: "npm install",
    runCommand(sample: string) {
        return `node main.js \"${sample}\"`;
    },
    copyInput: true,
    diffViaSchema: false,
    skipDiffViaSchema: [],
    allowMissingNull: false,
    features: ["enum", "union", "no-defaults", "strict-optional", "date-time"],
    output: "toplevel.js",
    topLevel: "TopLevel",
    skipJSON: [
        "ed095.json",
        "bug790.json", // renderer does not support recursion
        "recursive.json", // renderer does not support recursion
        "spotify-album.json", // renderer does not support recursion
        "76ae1.json" // renderer does not support recursion
    ],
    skipSchema: [],
    skipMiscJSON: false,
    rendererOptions: { "module-system": "es6" },
    quickTestRendererOptions: [
        { "runtime-typecheck": "false" },
        { "runtime-typecheck-ignore-unknown-properties": "true" },
        { converters: "top-level" }
    ],
    sourceFiles: ["src/Language/JavaScriptPropTypes.ts"]
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
    skipJSON: [
        "7681c.json" // year 0 is out of range
    ],
    skipMiscJSON: false,
    skipSchema: [
        "keyword-unions.schema" // can't handle "constructor" property
    ],
    rendererOptions: { "explicit-unions": "yes" },
    quickTestRendererOptions: [
        { "runtime-typecheck": "false" },
        { "runtime-typecheck-ignore-unknown-properties": "true" },
        { "nice-property-names": "true" },
        { "declare-unions": "true" }
    ],
    sourceFiles: ["src/language/Flow.ts"]
};

export const Scala3Language: Language = {
    name: "scala3",
    base: "test/fixtures/scala3",
    runCommand(sample: string) {
        return `cp "${sample}" sample.json && ./run.sh`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: ["bug427.json", "keywords.json"],
    allowMissingNull: true,
    features: ["enum", "union", "no-defaults"],
    output: "TopLevel.scala",
    topLevel: "TopLevel",
    skipJSON: [
        // These tests have "_" as a param name. Scala can't do this?
        "blns-object.json",
        "identifiers.json",
        "simple-identifiers.json",
        "keywords.json",

        // these actually work as far as I can tell, but seem to fail because properties are sorted differently
        // I don't think they fail... but I can't figure out sorting so hey ho let's skip them
        "github-events.json",
        "0a358.json",
        "0a91a.json",
        "34702.json",
        "76ae1.json",
        "af2d1.json",
        "bug427.json",
        "3d04a0.json",

        // Top level primitives... trivial,
        //  but annoying as it breaks compilation of the "Top Level" construct... which doesn't exist.
        // It's too much hassle to fix
        // and has no practical application in this context. Skip.
        "no-classes.json",

        // spaces in variables names doesn't seem to work
        "name-style.json",

        /*
I havea no idea how to encode these tests correctly. 
*/
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
        "nst-test-suite.json"
    ],
    skipSchema: [
        // 12 skips
        "required.schema",
        "multi-type-enum.schema", // I think it doesn't correctly realise this is an array of enums.
        "integer-string.schema",
        "intersection.schema",
        "implicit-class-array-union.schema",
        "date-time-or-string.schema",
        "implicit-one-of.schema",
        "go-schema-pattern-properties.schema",
        "enum.schema",
        "class-with-additional.schema",
        "class-map-union.schema",
        "keyword-unions.schema"
    ],
    skipMiscJSON: false,
    rendererOptions: { framework: "circe" },
    quickTestRendererOptions: [],
    sourceFiles: ["src/Language/Scala3.ts"]
};

export const Smithy4sLanguage: Language = {
    name: "smithy4a",
    base: "test/fixtures/smithy4s",
    runCommand(sample: string) {
        return `cp "${sample}" sample.json && ./run.sh`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: ["bug427.json", "keywords.json"],
    allowMissingNull: true,
    features: ["enum", "union", "no-defaults"],
    output: "TopLevel.scala",
    topLevel: "TopLevel",
    skipJSON: [
        // These tests have "_" as a param name. Scala can't do this?
        "blns-object.json",
        "identifiers.json",
        "simple-identifiers.json",
        "keywords.json",

        // these actually work as far as I can tell, but seem to fail because properties are sorted differently
        // I don't think they fail... but I can't figure out sorting so hey ho let's skip them
        "github-events.json",
        "0a358.json",
        "0a91a.json",
        "34702.json",
        "76ae1.json",
        "af2d1.json",
        "bug427.json",
        "3d04a0.json",

        // Top level primitives... trivial,
        //  but annoying as it breaks compilation of the "Top Level" construct... which doesn't exist.
        // It's too much hassle to fix
        // and has no practical application in this context. Skip.
        "no-classes.json",

        // spaces in variables names doesn't seem to work
        "name-style.json",

        /*
I havea no idea how to encode these tests correctly. 
*/
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
        "nst-test-suite.json"
    ],
    skipSchema: [],
    skipMiscJSON: false,
    rendererOptions: { framework: "just-types" },
    quickTestRendererOptions: [],
    sourceFiles: ["src/Language/Smithy4s.ts"]
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
        return `dart --enable-experiment=non-nullable parser.dart \"${sample}\"`;
    },
    diffViaSchema: false,
    skipDiffViaSchema: [],
    allowMissingNull: true,
    features: [],
    output: "TopLevel.dart",
    topLevel: "TopLevel",
    skipJSON: [
        "direct-recursive.json",
        "list.json",
        "combinations2.json",
        "combinations1.json",
        "combinations3.json",
        "combinations4.json",
        "recursive.json",
        "nbl-stats.json",
        "reddit.json",
        "pokedex.json",
        "bug427.json",
        "us-senators.json",
        "0a91a.json",
        "github-events.json",
        "keywords.json"
    ],
    skipSchema: [
        "enum-with-null.schema",
        "enum.schema",
        "bool-string.schema",
        "intersection.schema",
        "keyword-enum.schema",
        "integer-string.schema",
        "mutually-recursive.schema",
        "postman-collection.schema",
        "list.schema",
        "simple-ref.schema",
        "keyword-unions.schema",
        "ref-remote.schema",
        "uuid.schema"
    ],
    skipMiscJSON: true,
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

export const HaskellLanguage: Language = {
    name: "haskell",
    base: "test/fixtures/haskell",
    setupCommand: "stack install",
    compileCommand: "true",
    runCommand(sample: string) {
        return `stack run haskell -- "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [
        "bug863.json",
        "reddit.json",
        "github-events.json",
        "nbl-stats.json",
        "0a91a.json",
        "0e0c2.json",
        "29f47.json",
        "2df80.json",
        "27332.json",
        "34702.json",
        "6de06.json",
        "76ae1.json",
        "af2d1.json",
        "be234.json",
        "e8b04.json"
    ],
    allowMissingNull: false,
    features: ["enum", "union", "no-defaults"],
    output: "QuickType.hs",
    topLevel: "QuickType",
    skipJSON: [
        "00c36.json",
        "10be4.json",
        "050b0.json",
        "06bee.json",
        "07c75.json",
        "3536b.json",
        "13d8d.json",
        "43970.json",
        "570ec.json",
        "4d6fb.json",
        "66121.json",
        "5eae5.json",
        "6eb00.json",
        "7f568.json",
        "7fbfb.json",
        "8592b.json",
        "9847b.json",
        "996bd.json",
        "9a503.json",
        "9eed5.json",
        "ad8be.json",
        "ae7f0.json",
        "b4865.json",
        "cda6c.json",
        "c8c7e.json",
        "e53b5.json",
        "f3139.json",
        "f22f5.json",
        "nbl-stats.json",
        "bug855-short.json",
        "combinations4.json",
        "identifiers.json",
        "blns-object.json",
        "recursive.json",
        "bug427.json",
        "nst-test-suite.json",
        "keywords.json"
    ],
    skipMiscJSON: false,
    skipSchema: [
        "any.schema",
        "class-map-union.schema",
        "direct-union.schema",
        "enum.schema",
        "go-schema-pattern-properties.schema",
        "implicit-class-array-union.schema",
        "intersection.schema",
        "multi-type-enum.schema",
        "keyword-unions.schema",
        "optional-any.schema",
        "required.schema",
        "required-non-properties.schema"
    ],
    rendererOptions: {},
    quickTestRendererOptions: [{ "array-type": "list" }],
    sourceFiles: ["src/language/Haskell.ts"]
};

export const PHPLanguage: Language = {
    name: "php",
    base: "test/fixtures/php",
    runCommand: sample => `php main.php \"${sample}\"`,
    diffViaSchema: false,
    skipDiffViaSchema: [],
    allowMissingNull: true,
    features: ["enum"],
    output: "TopLevel.php",
    topLevel: "TopLevel",
    includeJSON: easySampleJSONs,
    skipMiscJSON: true,
    skipSchema: [],
    rendererOptions: {},
    quickTestRendererOptions: [],
    sourceFiles: ["src/Language/Php.ts"]
};

export const TypeScriptZodLanguage: Language = {
    name: "typescript-zod",
    base: "test/fixtures/typescript-zod",
    setupCommand: "npm install",
    runCommand(sample: string) {
        return `npm run --silent test "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [
        // Schema generated type uses first key as type name, JSON uses last
        "0cffa.json",
        "f6a65.json",
        "c3303.json",
        "7681c.json",
        "127a1.json",
        "26b49.json",

        "bug863.json",
        "reddit.json",
        "github-events.json",
        "nbl-stats.json",
        "0a91a.json",
        "0e0c2.json",
        "29f47.json",
        "2df80.json",
        "27332.json",
        "34702.json",
        "6de06.json",
        "76ae1.json",
        "af2d1.json",
        "be234.json",
        "e8b04.json"
    ],
    allowMissingNull: false,
    features: ["enum", "union", "no-defaults", "date-time"],
    output: "TopLevel.ts",
    topLevel: "TopLevel",
    skipJSON: [
        // Uses generated schema before it's defined
        "be234.json",
        "76ae1.json",
        "6de06.json",
        "2df80.json",
        "29f47.json",
        "spotify-album.json",
        "reddit.json",
        "github-events.json",

        // Does not handle recursive
        "direct-recursive.json",
        "list.json",
        "bug790.json",

        // Does not handle top level array
        "bug863.json",

        "no-classes.json",
        "00c36.json",
        "10be4.json",
        "050b0.json",
        "06bee.json",
        "07c75.json",
        "3536b.json",
        "13d8d.json",
        "43970.json",
        "570ec.json",
        "4d6fb.json",
        "66121.json",
        "5eae5.json",
        "6eb00.json",
        "7f568.json",
        "7fbfb.json",
        "8592b.json",
        "9847b.json",
        "996bd.json",
        "9a503.json",
        "9eed5.json",
        "ad8be.json",
        "ae7f0.json",
        "b4865.json",
        "cda6c.json",
        "c8c7e.json",
        "e53b5.json",
        "f3139.json",
        "f22f5.json",
        "nbl-stats.json",
        "bug855-short.json",
        "combinations4.json",
        "identifiers.json",
        "blns-object.json",
        "recursive.json",
        "bug427.json",
        "nst-test-suite.json",
        "keywords.json",
        "ed095.json",
        "7681c.json",
        "32d5c.json"
    ],
    skipMiscJSON: false,
    skipSchema: [
        "any.schema",
        "class-map-union.schema",
        "direct-union.schema",
        "enum.schema",
        "go-schema-pattern-properties.schema",
        "implicit-class-array-union.schema",
        "intersection.schema",
        "multi-type-enum.schema",
        "keyword-unions.schema",
        "optional-any.schema",
        "required.schema",
        "required-non-properties.schema"
    ],
    rendererOptions: {},
    quickTestRendererOptions: [{ "array-type": "list" }],
    sourceFiles: ["src/language/TypeScriptZod.ts"]
};

export const TypeScriptEffectSchemaLanguage: Language = {
    name: "typescript-effect-schema",
    base: "test/fixtures/typescript-effect-schema",
    setupCommand: "npm install",
    runCommand(sample: string) {
        return `npm run --silent test "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [
        // Schema generated type uses first key as type name, JSON uses last
        "0cffa.json",
        "f6a65.json",
        "c3303.json",
        "7681c.json",
        "127a1.json",
        "26b49.json",

        "bug863.json",
        "reddit.json",
        "github-events.json",
        "nbl-stats.json",
        "0a91a.json",
        "0e0c2.json",
        "29f47.json",
        "2df80.json",
        "27332.json",
        "34702.json",
        "6de06.json",
        "76ae1.json",
        "af2d1.json",
        "be234.json",
        "e8b04.json"
    ],
    allowMissingNull: false,
    features: ["enum", "union", "no-defaults"],
    output: "TopLevel.ts",
    topLevel: "TopLevel",
    skipJSON: [
        // Uses generated schema before it's defined
        "be234.json",
        "76ae1.json",
        "6de06.json",
        "2df80.json",
        "29f47.json",
        "spotify-album.json",
        "reddit.json",
        "github-events.json",

        // Does not handle recursive
        "direct-recursive.json",
        "list.json",
        "bug790.json",

        // Does not handle top level array
        "bug863.json",

        "no-classes.json",
        "00c36.json",
        "10be4.json",
        "050b0.json",
        "06bee.json",
        "07c75.json",
        "3536b.json",
        "13d8d.json",
        "43970.json",
        "570ec.json",
        "4d6fb.json",
        "66121.json",
        "5eae5.json",
        "6eb00.json",
        "7f568.json",
        "7fbfb.json",
        "8592b.json",
        "9847b.json",
        "996bd.json",
        "9a503.json",
        "9eed5.json",
        "ad8be.json",
        "ae7f0.json",
        "b4865.json",
        "cda6c.json",
        "c8c7e.json",
        "e53b5.json",
        "f3139.json",
        "f22f5.json",
        "nbl-stats.json",
        "bug855-short.json",
        "combinations4.json",
        "identifiers.json",
        "blns-object.json",
        "recursive.json",
        "bug427.json",
        "nst-test-suite.json",
        "keywords.json",
        "ed095.json"
    ],
    skipMiscJSON: false,
    skipSchema: [
        "any.schema",
        "class-map-union.schema",
        "direct-union.schema",
        "enum.schema",
        "go-schema-pattern-properties.schema",
        "implicit-class-array-union.schema",
        "intersection.schema",
        "multi-type-enum.schema",
        "keyword-unions.schema",
        "optional-any.schema",
        "required.schema",
        "required-non-properties.schema"
    ],
    rendererOptions: {},
    quickTestRendererOptions: [{ "array-type": "list" }],
    sourceFiles: ["src/language/TypeScriptEffectSchema.ts"]
};
