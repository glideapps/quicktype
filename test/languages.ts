import type { LanguageName } from "quicktype-core";

// @ts-expect-error: ../dist only exists after the root package is built
import type { RendererOptions } from "../dist/quicktype-core/Run";

// Shared `skipSchema` lists for failure modes that many languages have in
// common.  Spread these into a language's `skipSchema` instead of repeating
// the individual entries.  When a new test schema hits one of these failure
// modes, add it to the shared list so every affected language skips it at
// once.

// The language makes no int/double distinction in unions (e.g. an integer is
// implicitly accepted where a float union member is expected), so fail
// samples that rely on rejecting an int where a double is expected (or vice
// versa) do not fail.  Add any new schema whose fail sample relies on the
// int/float distinction.
const skipsIntFloatUnions = [
    "integer-float-union.schema",
    "minmax.schema",
    "union-int-double.schema",
];

// Untyped unions are unsupported: class|map unions and implicit class|array
// unions either don't compile or don't fail on the expected-failure samples.
// Add any new schema that relies on such unions.
const skipsUntypedUnions = [
    "class-map-union.schema",
    "implicit-class-array-union.schema",
];

// The generated code does not reject wrong-typed values in typed maps (a
// map<string, T> accepts values that are not T), so the bare `.fail.json`
// samples for these map-valued schemas do not fail as expected.  Add any new
// schema whose fail sample relies on rejecting a mistyped map value.
const skipsMapValueValidation = [
    "go-schema-pattern-properties.schema",
    "unevaluated-properties.schema",
];

export type LanguageFeature =
    | "enum"
    | "union"
    | "no-defaults"
    | "strict-optional"
    | "date-time"
    | "integer"
    | "integer-string"
    | "bool-string"
    | "uuid"
    | "minmax"
    | "minmaxInteger"
    | "minmaxlength"
    | "minmaxitems"
    | "pattern";

export interface Language {
    name: LanguageName;
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

export const JSONSchemaLanguage: Language = {
    name: "schema",
    base: "test/fixtures/schema",
    runCommand(sample: string) {
        return `node main.js "${sample}"`;
    },
    diffViaSchema: false,
    skipDiffViaSchema: [],
    allowMissingNull: false,
    features: [
        "enum",
        "union",
        "no-defaults",
        "strict-optional",
        "date-time",
        "uuid",
        "integer",
        "minmax",
        "minmaxitems",
        "minmaxlength",
        "minmaxitems",
        "pattern",
    ],
    output: "TopLevel.schema",
    topLevel: "TopLevel",
    skipJSON: [],
    skipMiscJSON: false,
    skipSchema: [],
    rendererOptions: {},
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/JSONSchema/JSONSchemaRenderer.ts"],
};

export const CSharpLanguage: Language = {
    name: "csharp",
    base: "test/fixtures/csharp",
    // https://github.com/dotnet/cli/issues/1582
    setupCommand: "dotnet restore -p:CheckEolTargetFramework=false --no-cache",
    runCommand(sample: string) {
        return `dotnet run -p:CheckEolTargetFramework=false -- "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: ["34702.json"],
    allowMissingNull: false,
    features: [
        "enum",
        "union",
        "no-defaults",
        "strict-optional",
        "date-time",
        "integer-string",
        "bool-string",
        "uuid",
    ],
    output: "QuickType.cs",
    topLevel: "TopLevel",
    skipJSON: [],
    skipMiscJSON: false,
    skipSchema: [],
    // The default framework is SystemTextJson; this fixture deliberately
    // pins NewtonSoft so the Newtonsoft renderer keeps end-to-end coverage.
    rendererOptions: { "check-required": "true", framework: "NewtonSoft" },
    quickTestRendererOptions: [
        { "array-type": "list" },
        // The default is csharp-version=8; these keep the older
        // language-version code paths covered.
        { "csharp-version": "5" },
        { "csharp-version": "6" },
        { density: "dense" },
        { "number-type": "decimal" },
        { "any-type": "dynamic" },
    ],
    sourceFiles: ["src/language/CSharp/index.ts"],
};

export const CSharpLanguageRecords: Language = {
    ...CSharpLanguage,
    rendererOptions: {
        ...CSharpLanguage.rendererOptions,
        "use-records": "true",
    },
};

export const CSharpLanguageSystemTextJson: Language = {
    name: "csharp",
    base: "test/fixtures/csharp-SystemTextJson",
    // https://github.com/dotnet/cli/issues/1582
    setupCommand: "dotnet restore -p:CheckEolTargetFramework=false --no-cache",
    runCommand(sample: string) {
        return `dotnet run -p:CheckEolTargetFramework=false -- "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: ["34702.json"],
    allowMissingNull: false,
    features: [
        "enum",
        "union",
        "no-defaults",
        "strict-optional",
        "date-time",
        "integer-string",
        "bool-string",
        "uuid",
        "integer",
    ],
    output: "QuickType.cs",
    topLevel: "TopLevel",
    skipJSON: [],
    skipMiscJSON: false,
    skipSchema: [
        // The following skips are pre-existing System.Text.Json renderer issues,
        // found when first enabling the schema fixture for this language:
        // minmaxlength.schema, optional-constraints.schema, and
        // optional-const-ref.schema used to be skipped here because the
        // generated converters triggered CS8602 warnings, which "dotnet
        // run" prints to stdout, breaking the JSON comparison.  The
        // generated code now suppresses CS8602 alongside the other NRT
        // pragmas, so they run.  (Their .fail.<feature>.json samples are
        // not exercised because this fixture doesn't declare the minmax,
        // minmaxlength, or pattern features.)
    ],
    rendererOptions: { "check-required": "true", framework: "SystemTextJson" },
    quickTestRendererOptions: [
        { "array-type": "list" },
        // The default is csharp-version=8; these keep the older
        // language-version code paths covered.
        { "csharp-version": "5" },
        { "csharp-version": "6" },
        { density: "dense" },
        { "number-type": "decimal" },
        { "any-type": "dynamic" },
        // Suppressing the DateOnly/TimeOnly converters (for pre-.NET 6
        // targets) must still produce compiling, round-tripping code.
        ["unions.json", { "dateonly-timeonly-converters": "false" }],
    ],
    sourceFiles: ["src/language/CSharp/index.ts"],
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
    features: ["enum", "union", "uuid", "date-time", "integer"],
    output: "src/main/java/io/quicktype/TopLevel.java",
    topLevel: "TopLevel",
    skipJSON: [],
    skipMiscJSON: false,
    skipSchema: [],
    rendererOptions: {},
    // The default is array-type=list; this keeps the T[] code path
    // covered.
    quickTestRendererOptions: [{ "array-type": "array" }],
    sourceFiles: ["src/language/Java/index.ts"],
};

export const JavaLanguageWithLegacyDateTime: Language = {
    ...JavaLanguage,
    skipSchema: [
        ...JavaLanguage.skipSchema,
        "date-time.schema", // Expects less strict serialization.
    ],
    skipJSON: [
        ...(JavaLanguage.skipJSON !== undefined ? JavaLanguage.skipJSON : []),
    ],
    skipMiscJSON: true, // Handles edge cases differently and does not allow optional milliseconds.
    rendererOptions: { "datetime-provider": "legacy" },
    quickTestRendererOptions: [{ "array-type": "array" }],
};

export const JavaLanguageWithLombok: Language = {
    ...JavaLanguage,
    base: "test/fixtures/java-lombok",
    skipJSON: [],
    quickTestRendererOptions: [{ "array-type": "array", lombok: "true" }],
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
        "f6a65.json",
    ],
    allowMissingNull: true,
    features: [
        "enum",
        "union",
        "no-defaults",
        "date-time",
        "integer-string",
        "bool-string",
        "uuid",
        "integer",
    ],
    output: "quicktype.py",
    topLevel: "TopLevel",
    skipJSON: [],
    skipMiscJSON: false,
    skipSchema: [],
    rendererOptions: {},
    quickTestRendererOptions: [
        // The default is "3.10"; keep the older feature sets covered.
        { "python-version": "3.5" },
        { "python-version": "3.6" },
        { "python-version": "3.7" },
        { "python-version": "3.9" },
    ],
    sourceFiles: ["src/language/Python/index.ts"],
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
        "0a91a.json",
        "0cffa.json",
        "127a1.json",
        "26b49.json",
        "34702.json",
        "7681c.json",
        "76ae1.json",
        "af2d1.json",
        "c3303.json",
        "f6a65.json",
    ],
    allowMissingNull: false,
    features: ["enum", "union", "no-defaults", "integer"],
    output: "module_under_test.rs",
    topLevel: "TopLevel",
    skipJSON: [],
    skipSchema: [],
    skipMiscJSON: false,
    rendererOptions: {},
    quickTestRendererOptions: [
        { density: "dense" },
        { visibility: "crate" },
        // The pre-flip defaults: private fields without Debug/Clone
        // derives, kept covered after the defaults changed.
        {
            visibility: "private",
            "derive-debug": "false",
            "derive-clone": "false",
        },
        // Exercise the integer-type option against schemas with integer
        // bounds.  force-i32 is pinned to a schema whose sample values
        // all fit in i32 so the round-trip still succeeds.
        ["integer-type.schema", { "integer-type": "conservative" }],
        ["integer-type.schema", { "integer-type": "force-i64" }],
        ["minmax-integer.schema", { "integer-type": "force-i32" }],
    ],
    sourceFiles: ["src/language/Rust/index.ts"],
};

export const CrystalLanguage: Language = {
    name: "crystal",
    base: "test/fixtures/crystal",
    compileCommand: "crystal build -o quicktype main.cr",
    runCommand(sample: string) {
        return `./quicktype "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [
        "keywords.json",
        "bug427.json",
        "recursive.json",
        "github-events.json",
        "32431.json",
        "0cffa.json",
        "af2d1.json",
        "0a91a.json",
        "4961a.json",
        "26b49.json",
        "68c30.json",
        "c3303.json",
        "76ae1.json",
        "34702.json",
        "f6a65.json",
        "7681c.json",
        "127a1.json",
    ],
    allowMissingNull: true,
    features: ["union", "no-defaults", "integer"],
    output: "TopLevel.cr",
    topLevel: "TopLevel",
    skipJSON: [
        "blns-object.json",
        "identifiers.json",
        "simple-identifiers.json",
        "nst-test-suite.json",
    ],
    skipSchema: [],
    skipMiscJSON: false,
    rendererOptions: {},
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/Crystal/index.ts"],
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
        "e8b04.json",
    ],
    allowMissingNull: true,
    features: [
        "enum",
        "union",
        "no-defaults",
        "integer",
        "minmax",
        "minmaxlength",
        "minmaxitems",
        "pattern",
        "strict-optional",
        "uuid",
        "date-time",
    ],
    output: "TopLevel.rb",
    topLevel: "TopLevel",
    skipJSON: [],
    skipSchema: [],
    skipMiscJSON: false,
    rendererOptions: {},
    quickTestRendererOptions: [["pokedex.json", { namespace: "QuickType" }]],
    sourceFiles: ["src/language/ruby/index.ts"],
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
        "34702.json",
        "e8b04.json",
    ],
    allowMissingNull: false,
    features: ["enum", "union", "integer"],
    output: "quicktype.go",
    topLevel: "TopLevel",
    skipJSON: [
        "identifiers.json",
        "simple-identifiers.json",
        "blns-object.json",
        "nst-test-suite.json",
    ],
    skipMiscJSON: false,
    skipSchema: [],
    rendererOptions: {},
    quickTestRendererOptions: [
        // Runs against the expected-output file
        // `omit-empty.out.omit-empty.json`, which asserts that nullable
        // fields preserve null instead of being omitted.
        ["omit-empty.json", { "omit-empty": "true" }],
        ["nullable-optional-one-of.schema", { "omit-empty": "true" }],
        ["enum.schema", { "enum-type-name-suffix": "true" }],
    ],
    sourceFiles: ["src/language/Golang/index.ts"],
};

/* The vendored dependencies are downloaded into deps/ and included via
 * -isystem so that generated cross-file includes must be quoted includes
 * (resolved relative to the including file): a generated
 * `#include <TopLevel.h>` fails to compile. */
const cJSONSetupCommand =
    "mkdir -p deps && curl -o deps/cJSON.c https://raw.githubusercontent.com/DaveGamble/cJSON/v1.7.15/cJSON.c && curl -o deps/cJSON.h https://raw.githubusercontent.com/DaveGamble/cJSON/v1.7.15/cJSON.h && curl -o deps/list.h https://raw.githubusercontent.com/joelguittet/c-list/master/include/list.h && curl -o deps/list.c https://raw.githubusercontent.com/joelguittet/c-list/master/src/list.c && curl -o deps/hashtable.h https://raw.githubusercontent.com/joelguittet/c-hashtable/master/include/hashtable.h && curl -o deps/hashtable.c https://raw.githubusercontent.com/joelguittet/c-hashtable/master/src/hashtable.c";

function cJSONRunCommand(sample: string): string {
    return `valgrind --leak-check=full --show-leak-kinds=all --track-origins=yes --error-exitcode=1 ./quicktype "${sample}"`;
}

export const CJSONLanguage: Language = {
    name: "cjson",
    base: "test/fixtures/cjson",
    setupCommand: cJSONSetupCommand,
    /* second.c is a second translation unit including TopLevel.h; it verifies
     * that the generated header/source split supports multi-TU builds. */
    compileCommand:
        "gcc -O0 -o quicktype -isystem deps deps/cJSON.c deps/hashtable.c deps/list.c main.c second.c TopLevel.c -lpthread",
    runCommand: cJSONRunCommand,
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
        "keywords.json",
    ],
    allowMissingNull: false,
    features: [
        "minmax",
        "minmaxInteger",
        "minmaxitems",
        "minmaxlength",
        "pattern",
        "enum",
        "union",
        "no-defaults",
        "strict-optional",
        "integer",
    ],
    output: "TopLevel.h",
    topLevel: "TopLevel",
    skipJSON: [
        /* cJSON is not able to parse input with special characters */
        "nst-test-suite.json",
        /* Union with no name in nullable Array in Array is not supported */
        "combinations1.json",
        "combinations3.json",
        /* Map in Array in TopLevel is not supported (for the current implementation, can be added later, need recursivity) */
        "combinations2.json",
    ],
    skipMiscJSON: false,
    skipSchema: [
        /* Enum as TopLevel is not supported */
        "top-level-enum.schema",
        /* Union, Map and Arrays with invalid types are not checked (for the current implementation, can be added later, should abord parsing and return NULL) */
        ...skipsMapValueValidation.filter(
            (schema) =>
                schema !== "go-schema-pattern-properties.schema" &&
                schema !== "unevaluated-properties.schema",
        ),
        /* Required properties absent are not checked (for the current implementation, can be added later, should abord parsing and return NULL) */
        /* Pure Any type not supported (for the current implementation, can be added later, should manage a callback to provide the final application a way to handle it at parsing and creation of cJSON) */
        /* Class elements with invalid type are not checked (for the current implementation, can be added later, should abord parsing and return NULL) */
        ...skipsUntypedUnions.filter(
            (schema) => schema !== "class-map-union.schema",
        ),
    ],
    rendererOptions: { "header-only": "false" },
    quickTestRendererOptions: [
        { "source-style": "single-source", "header-only": "false" },
    ],
    sourceFiles: ["src/language/CJSON/index.ts"],
};

/* Minimal fixtures covering the remaining source-style / header-only mode
 * combinations on a single complex input (enums, unions, many classes).
 * They share the cjson driver directory and setup. */

/* Default options: single-source, header-only.  Single translation unit,
 * no generated TopLevel.c — the pre-existing output mode. */
export const CJSONDefaultLanguage: Language = {
    name: "cjson",
    base: "test/fixtures/cjson",
    setupCommand: cJSONSetupCommand,
    compileCommand:
        "gcc -O0 -o quicktype -isystem deps deps/cJSON.c deps/hashtable.c deps/list.c main.c -lpthread",
    runCommand: cJSONRunCommand,
    diffViaSchema: false,
    skipDiffViaSchema: [],
    allowMissingNull: false,
    features: ["minmaxitems"],
    output: "TopLevel.h",
    topLevel: "TopLevel",
    includeJSON: ["nbl-stats.json"],
    skipMiscJSON: true,
    skipSchema: ["integer-before-number.schema"], // Python-specific union-order regression.
    rendererOptions: {},
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/CJSON/index.ts"],
};

/* Multi-source, header-only.  One header per type; still a single
 * translation unit, since header-only output defines functions in the
 * headers and cannot link from multiple translation units. */
export const CJSONMultiHeaderLanguage: Language = {
    name: "cjson",
    base: "test/fixtures/cjson",
    setupCommand: cJSONSetupCommand,
    compileCommand:
        "gcc -O0 -o quicktype -isystem deps deps/cJSON.c deps/hashtable.c deps/list.c main.c -lpthread",
    runCommand: cJSONRunCommand,
    diffViaSchema: false,
    skipDiffViaSchema: [],
    allowMissingNull: false,
    features: [],
    output: "TopLevel.h",
    topLevel: "TopLevel",
    includeJSON: ["nbl-stats.json"],
    skipMiscJSON: true,
    skipSchema: ["integer-before-number.schema"], // Python-specific union-order regression.
    rendererOptions: { "source-style": "multi-source" },
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/CJSON/index.ts"],
};

/* Multi-source, split header/source pairs.  The wildcard picks up main.c,
 * second.c and every generated .c file; linking the two translation units
 * verifies the core promise of the split mode (issue #2617). */
export const CJSONMultiSplitLanguage: Language = {
    name: "cjson",
    base: "test/fixtures/cjson",
    setupCommand: cJSONSetupCommand,
    compileCommand:
        "gcc -O0 -o quicktype -isystem deps deps/cJSON.c deps/hashtable.c deps/list.c *.c -lpthread",
    runCommand: cJSONRunCommand,
    diffViaSchema: false,
    skipDiffViaSchema: [],
    allowMissingNull: false,
    features: [],
    output: "TopLevel.h",
    topLevel: "TopLevel",
    includeJSON: ["nbl-stats.json"],
    skipMiscJSON: true,
    skipSchema: ["integer-before-number.schema"], // Python-specific union-order regression.
    rendererOptions: {
        "source-style": "multi-source",
        "header-only": "false",
    },
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/CJSON/index.ts"],
};

export const CPlusPlusLanguage: Language = {
    name: "cplusplus",
    base: "test/fixtures/cplusplus",
    setupCommand:
        "curl -o json.hpp https://raw.githubusercontent.com/nlohmann/json/87df1d6708915ffbfa26a051ad7562ecc22e5579/src/json.hpp",
    compileCommand:
        "g++ -O0 -o quicktype -std=c++17 -Werror=unused-parameter main.cpp",
    runCommand(sample: string) {
        return `./quicktype "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [
        "github-events.json",
        "bug427.json",
        "keywords.json",
        "0a91a.json",
        "34702.json",
        "7f568.json",
        "e8b04.json",
        "fcca3.json",
    ],
    allowMissingNull: false,
    features: [
        "minmax",
        "minmaxlength",
        "pattern",
        "enum",
        "union",
        "no-defaults",
        "integer",
        "minmaxitems",
        "strict-optional",
        "uuid",
        "date-time",
    ],
    output: "quicktype.hpp",
    topLevel: "TopLevel",
    skipJSON: [],
    skipMiscJSON: false,
    skipSchema: [],
    rendererOptions: {},
    quickTestRendererOptions: [
        { "code-format": "with-struct" },
        // bug2521.json has an optional string, exercising UTF conversion
        // through std::optional.
        ["bug2521.json", { wstring: "use-wstring" }],
        { "const-style": "east-const" },
        // The default is boost=false (C++17); this keeps the boost code
        // path covered.  unions.json exercises nulls inside unions, where
        // the boost and std optional/variant code paths differ.
        ["unions.json", { boost: "true" }],
        ["pokedex.json", { boost: "true" }],
        ["optional-any.schema", { "hide-null-optional": "true" }],
    ],
    sourceFiles: ["src/language/CPlusPlus/index.ts"],
};

export const CPlusPlusMultiSourceLanguage: Language = {
    ...CPlusPlusLanguage,
    includeJSON: ["pokedex.json"],
    rendererOptions: { "source-style": "multi-source" },
    quickTestRendererOptions: [],
};

export const ElmLanguage: Language = {
    name: "elm",
    base: "test/fixtures/elm",
    // Compiling `Warmup.elm` once up front downloads and builds all package
    // dependencies into the shared ELM_HOME cache; elm corrupts its shared
    // package cache when parallel compiles race on a cold cache (still
    // reproducible with elm 0.19.2).
    setupCommand: "rm -rf elm-stuff && elm make Warmup.elm --output=/dev/null",
    // The retry after clearing elm-stuff works around the compiler's flaky
    // per-project cache locking ("d.dat: withBinaryFile: resource busy",
    // elm/compiler#2258), which strikes under heavy parallel load.
    compileCommand:
        "elm make Main.elm --output elm.js || (rm -rf elm-stuff && elm make Main.elm --output elm.js)",
    runCommand(sample: string) {
        return `node ./runner.js "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [
        "identifiers.json",
        "keywords.json",
        "github-events.json",
        "nbl-stats.json",
        "0a91a.json",
        "0e0c2.json",
        "34702.json",
        "76ae1.json",
        "af2d1.json",
        "e8b04.json",
    ],
    allowMissingNull: false,
    features: [
        "enum",
        "union",
        "no-defaults",
        "strict-optional",
        "integer",
        "minmax",
        "minmaxInteger",
        "minmaxitems",
        "minmaxlength",
    ],
    output: "QuickType.elm",
    topLevel: "QuickType",
    // Elm type aliases cannot be recursive, so all inputs that produce
    // recursive types must be skipped.
    skipJSON: [
        "recursive.json", // recursion
        "direct-recursive.json", // recursion
        "bug427.json", // recursion
        "bug790.json", // recursion
        "list.json", // recursion
    ],
    skipMiscJSON: false,
    skipSchema: [
        "union-list.schema", // recursion
        "list.schema", // recursion
        "ref-remote.schema", // recursion
        "mutually-recursive.schema", // recursion
        "postman-collection.schema", // recursion
        "vega-lite.schema", // recursion
        "simple-ref.schema", // recursion
        "recursive-union-flattening.schema", // recursion
        "rust-cycle-breaker-union.schema", // recursion
    ],
    rendererOptions: {},
    // `list` is the default now; keep the `Array` code path covered.
    quickTestRendererOptions: [{ "array-type": "array" }],
    sourceFiles: ["src/language/Elm/index.ts"],
};

export const SwiftLanguage: Language = {
    name: "swift",
    base: "test/fixtures/swift",
    compileCommand: "swiftc -o quicktype main.swift quicktype.swift",
    runCommand(sample: string) {
        return `./quicktype "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [
        "bug427.json",
        "blns-object.json",
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
    ],
    allowMissingNull: true,
    features: ["enum", "union", "no-defaults", "date-time", "uuid", "integer"],
    output: "quicktype.swift",
    topLevel: "TopLevel",
    skipJSON: [
        // Doesn't seem to work on Linux, works on MacOS
        "nst-test-suite.json",
    ],
    skipMiscJSON: false,
    skipSchema: [],
    rendererOptions: { "support-linux": "true" },
    quickTestRendererOptions: [
        { "support-linux": "false" },
        { "struct-or-class": "class" },
        [
            "simple-object.json",
            { "struct-or-class": "class", "final-classes": "true" },
        ],
        // The default is density=normal; this keeps the dense code path
        // covered.
        { density: "dense" },
        { "access-level": "internal" },
        { "access-level": "public" },
        { protocol: "equatable" },
        ["simple-object.json", { protocol: "hashable" }],
    ],
    sourceFiles: ["src/language/Swift/index.ts"],
};

export const SwiftSendableObjectiveCSupportLanguage: Language = {
    ...SwiftLanguage,
    compileCommand: "node verify-sendable.cjs",
    diffViaSchema: false,
    includeJSON: ["pokedex.json"],
    rendererOptions: {
        ...SwiftLanguage.rendererOptions,
        sendable: "true",
        "struct-or-class": "class",
        "objective-c-support": "true",
    },
    quickTestRendererOptions: [
        ["pokedex.json", { "struct-or-class": "struct" }],
    ],
    runCommand: undefined,
    skipMiscJSON: true,
};

export const ObjectiveCLanguage: Language = {
    name: "objective-c",
    base: "test/fixtures/objective-c",
    compileCommand: "clang -Werror -framework Foundation *.m -o test",
    runCommand(sample: string) {
        return `cp "${sample}" sample.json && ./test sample.json`;
    },
    diffViaSchema: false,
    skipDiffViaSchema: [],
    allowMissingNull: true,
    features: [
        "enum",
        "integer",
        "minmax",
        "minmaxInteger",
        "minmaxitems",
        "pattern",
        "minmaxlength",
        "no-defaults",
        "strict-optional",
        "uuid",
        "date-time",
    ],
    output: "QTTopLevel.m",
    topLevel: "QTTopLevel",
    skipJSON: [
        // Almost all strings work except any containing \u001b
        // See https://goo.gl/L8HfUP
        "blns-object.json",
    ],
    skipMiscJSON: false,
    skipSchema: [],
    rendererOptions: { functions: "true" },
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/Objective-C/index.ts"],
};

export const TypeScriptLanguage: Language = {
    name: "typescript",
    base: "test/fixtures/typescript",
    // tsx doesn't type-check, so compile explicitly to catch type errors
    // in the generated code
    compileCommand: "tsc -p .",
    runCommand(sample: string) {
        return `tsx main.ts "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [],
    allowMissingNull: false,
    features: [
        "enum",
        "union",
        "no-defaults",
        "strict-optional",
        "date-time",
        "integer",
        "pattern",
        "uuid",
        "minmaxitems",
        "minmaxlength",
        "minmax",
    ],
    output: "TopLevel.ts",
    topLevel: "TopLevel",
    skipJSON: [],
    skipMiscJSON: false,
    skipSchema: [],
    rendererOptions: { "explicit-unions": "yes" },
    quickTestRendererOptions: [
        { "runtime-typecheck": "false" },
        { "runtime-typecheck-ignore-unknown-properties": "true" },
        { "nice-property-names": "true" },
        ["pokedex.json", { "prefer-types": "true" }],
        { "acronym-style": "pascal" },
        { converters: "all-objects" },
        { readonly: "true" },
        // The default is prefer-unions=true; this keeps the TypeScript
        // enum code path covered.
        { "prefer-unions": "false" },
        { "prefer-unknown": "false" },
    ],
    sourceFiles: ["src/language/TypeScript/index.ts"],
};

export const JavaScriptLanguage: Language = {
    name: "javascript",
    base: "test/fixtures/javascript",
    runCommand(sample: string) {
        return `node main.js "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [],
    allowMissingNull: false,
    features: [
        "enum",
        "union",
        "no-defaults",
        "strict-optional",
        "date-time",
        "integer",
        "pattern",
        "uuid",
        "minmaxitems",
        "minmaxlength",
        "minmax",
    ],
    output: "TopLevel.js",
    topLevel: "TopLevel",
    skipJSON: [],
    skipMiscJSON: false,
    skipSchema: [],
    rendererOptions: {},
    quickTestRendererOptions: [
        { "runtime-typecheck": "false" },
        { "runtime-typecheck-ignore-unknown-properties": "true" },
        { converters: "top-level" },
        ["nested-objects.json", { converters: "all-objects" }],
    ],
    sourceFiles: ["src/language/JavaScript/index.ts"],
};

export const JavaScriptPropTypesLanguage: Language = {
    name: "javascript-prop-types",
    base: "test/fixtures/javascript-prop-types",
    setupCommand: "npm install",
    runCommand(sample: string) {
        return `node main.js "${sample}"`;
    },
    copyInput: true,
    diffViaSchema: false,
    skipDiffViaSchema: [],
    allowMissingNull: false,
    features: [
        "enum",
        "union",
        "integer",
        "date-time",
        "minmaxlength",
        "minmax",
        "minmaxitems",
        "pattern",
        "uuid",
        "strict-optional",
        "no-defaults",
    ],
    output: "toplevel.js",
    topLevel: "TopLevel",
    skipJSON: [],
    skipSchema: [],
    skipMiscJSON: false,
    rendererOptions: { "module-system": "es6" },
    quickTestRendererOptions: [{ converters: "top-level" }],
    sourceFiles: ["src/language/JavaScriptPropTypes/index.ts"],
};

export const FlowLanguage: Language = {
    name: "flow",
    base: "test/fixtures/flow",
    runCommand(sample: string) {
        return `flow check 1>&2 && flow-node main.js "${sample}"`;
    },
    diffViaSchema: false,
    skipDiffViaSchema: [],
    allowMissingNull: false,
    features: [
        "enum",
        "union",
        "no-defaults",
        "strict-optional",
        "date-time",
        "integer",
        "pattern",
        "uuid",
        "minmaxitems",
        "minmaxlength",
        "minmax",
    ],
    output: "TopLevel.js",
    topLevel: "TopLevel",
    skipJSON: [],
    skipMiscJSON: false,
    skipSchema: [],
    rendererOptions: { "explicit-unions": "yes" },
    quickTestRendererOptions: [
        { "runtime-typecheck": "false" },
        { "runtime-typecheck-ignore-unknown-properties": "true" },
        { "nice-property-names": "true" },
        // Flow always renders enums as unions of string literals, so
        // this only asserts that the flipped default stays a no-op for
        // Flow output.
        { "prefer-unions": "false" },
        { "prefer-unknown": "false" },
    ],
    sourceFiles: ["src/language/Flow/index.ts"],
};

export const Scala3Language: Language = {
    name: "scala3",
    base: "test/fixtures/scala3",
    runCommand(sample: string) {
        return `cp "${sample}" sample.json && ./run.sh`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [
        "bug427.json",
        // Property names generated from JSON and JSON Schema can differ when
        // they collide with differently inferred class names.
        "blns-object.json",
        // These round-trip fine; the code generated via JSON Schema
        // orders one property differently (a pre-existing
        // alphabetization quirk around renamed keyword properties).
        "github-events.json",
        "0a91a.json",
        "34702.json",
        "76ae1.json",
        "af2d1.json",
    ],
    allowMissingNull: true,
    features: ["enum", "union", "no-defaults", "integer", "date-time", "uuid"],
    output: "TopLevel.scala",
    topLevel: "TopLevel",
    skipJSON: [],
    skipSchema: [
        // The generated case class exceeds the JVM's 254-parameter limit.
        "keyword-unions.schema",
    ],
    skipMiscJSON: false,
    rendererOptions: { framework: "circe" },
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/Scala3/index.ts"],
};

export const Scala3UpickleLanguage: Language = {
    name: "scala3",
    base: "test/fixtures/scala3-upickle",
    runCommand(sample: string) {
        return `cp "${sample}" sample.json && ./run.sh`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [
        "bug427.json",
        // Property names generated from JSON and JSON Schema can differ when
        // they collide with differently inferred class names.
        "blns-object.json",
        // These round-trip fine; the code generated via JSON Schema
        // orders one property differently (a pre-existing
        // alphabetization quirk around renamed keyword properties).
        "github-events.json",
        "0a91a.json",
        "34702.json",
        "76ae1.json",
        "af2d1.json",
    ],
    allowMissingNull: true,
    features: [
        "enum",
        "union",
        "no-defaults",
        "integer",
        "strict-optional",
        "date-time",
        "uuid",
    ],
    output: "TopLevel.scala",
    topLevel: "TopLevel",
    skipJSON: [],
    skipSchema: [
        // The generated case class exceeds the JVM's 254-parameter limit.
        "keyword-unions.schema",
    ],
    skipMiscJSON: false,
    rendererOptions: { framework: "upickle" },
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/Scala3/index.ts"],
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
        "php-mixed-union.json",
        "nst-test-suite.json",
    ],
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
    ],
    skipMiscJSON: false,
    rendererOptions: { "just-types": "true" },
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/Smithy4s/index.ts"],
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
        "76ae1.json",
    ],
    allowMissingNull: true,
    features: ["enum", "union", "no-defaults", "date-time", "integer"],
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
        "php-mixed-union.json",
        "nst-test-suite.json",
        // These should be enabled
        // TODO Investigate these
        "af2d1.json",
    ],
    skipSchema: [
        // Very weird - the types are correct, but it can (de)serialize the string,
        // which is not represented in the types (implicit-class-array-union);
        // class-map-union: KlaxonException: Couldn't find a suitable constructor for class UnionValue to initialize with {}
        ...skipsUntypedUnions,
        // Deserializes an array where a union of two classes is expected
        // instead of rejecting it.
        "nested-intersection-union.schema",
        "class-with-additional.schema",
        ...skipsMapValueValidation,
        // IllegalArgumentException
        // KlaxonException: Need to extract inside
        "bool-string.schema",
        "integer-string.schema",
        "uuid.schema",
        // produces {"foo" : "java.lang.Object@48d61b48"}
        "any.schema",
        // KlaxonException: Couldn't find a suitable constructor for class UnionValue to initialize with {}
        "direct-union.schema",
        // Some weird name collision
        "keyword-unions.schema",
    ],
    skipMiscJSON: false,
    // The default framework is jackson; this fixture deliberately pins
    // klaxon so the Klaxon renderer keeps end-to-end coverage.
    rendererOptions: { framework: "klaxon" },
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/Kotlin/index.ts"],
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
        "blns-object.json",
        // TODO Investigate these
        "34702.json",
        "76ae1.json",
    ],
    allowMissingNull: true,
    features: [
        "enum",
        "union",
        "no-defaults",
        "strict-optional",
        "date-time",
        "integer",
        "minmaxitems",
        "minmax",
        "minmaxlength",
        "pattern",
    ],
    output: "TopLevel.kt",
    topLevel: "TopLevel",
    skipJSON: [],
    skipSchema: ["keyword-unions.schema"],
    skipMiscJSON: false,
    rendererOptions: { framework: "jackson" },
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/Kotlin/index.ts"],
};

export const KotlinXLanguage: Language = {
    name: "kotlin",
    base: "test/fixtures/kotlinx",
    compileCommand: "./build.sh",
    runCommand(sample: string) {
        return `./run.sh "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [
        "bug427.json",
        "keywords.json",
        "77392.json",
        "b4865.json",
        // TODO Investigate these
        "34702.json",
        "76ae1.json",
    ],
    allowMissingNull: true,
    // No "union": the kotlinx renderer emits unions as sealed classes
    // without any serializer wiring, so they don't (de)serialize
    // (documented TODO in KotlinXRenderer.ts).
    // "date-time" is supported via emitted KSerializers, but note that
    // date-time.schema itself stays skipped: its union-array properties
    // hit the union limitation above. The serializers are exercised by
    // the JSON inputs with inferred date-times instead.
    features: ["enum", "no-defaults", "date-time", "integer"],
    output: "TopLevel.kt",
    topLevel: "TopLevel",
    skipJSON: [
        // Unions render as sealed classes without serializer wiring, so
        // deserialization fails at runtime (documented TODO in
        // KotlinXRenderer.ts).
        "combinations1.json",
        "combinations2.json",
        "combinations3.json",
        "combinations4.json",
        "kitchen-sink.json",
        "nbl-stats.json",
        "nst-test-suite.json",
        "26c9c.json",
        "617e8.json",
        "a0496.json",
        "a3d8c.json",
        "f74d5.json",
        "fcca3.json",
        "blns-object.json", // JSON-to-schema property naming is not stable for case collisions.
    ],
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        // Unions render as sealed classes without serializer wiring, so
        // deserialization fails at runtime (documented TODO in
        // KotlinXRenderer.ts).
        "enum.schema", // enum.3.json contains an int|string union
        // Additionally exceeds the JVM's 255-parameter limit when the
        // serialization plugin generates the synthesized constructors.
        "keyword-unions.schema",
    ],
    skipMiscJSON: false,
    rendererOptions: { framework: "kotlinx" },
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/Kotlin/index.ts"],
};

export const DartLanguage: Language = {
    name: "dart",
    base: "test/fixtures/dart",
    runCommand(sample: string) {
        return `dart --enable-experiment=non-nullable parser.dart "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [
        "keywords.json",
        "bug427.json",
        "bug863.json",
        "f6a65.json",
        "e53b5.json",
        "7681c.json",
        "127a1.json",
        "fcca3.json",
        "34702.json",
        "c8c7e.json",
        "c3303.json",
        "00c36.json",
        "76ae1.json",
        "26b49.json",
        "cda6c.json",
        "e8b04.json",
        "2df80.json",
        "0cffa.json",
        "7fbfb.json",
    ],
    allowMissingNull: true,
    features: [
        "integer",
        "no-defaults",
        "date-time",
        "minmaxlength",
        "pattern",
        "minmax",
        "enum",
        "minmaxitems",
    ],
    output: "TopLevel.dart",
    topLevel: "TopLevel",
    skipJSON: [],
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
    ],
    skipMiscJSON: false,
    rendererOptions: {},
    // The default is final-props=true; this keeps the mutable-property
    // code path covered.  The targeted from-map sample also verifies that
    // the fixture driver can keep calling the top-level JSON string helpers.
    quickTestRendererOptions: [
        { "final-props": "false" },
        ["simple-object.json", { "from-map": "true" }],
    ],
    sourceFiles: ["src/language/Dart/index.ts"],
};

export const PikeLanguage: Language = {
    name: "pike",
    base: "test/fixtures/pike",
    runCommand(sample: string) {
        return `pike main.pike "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [
        "keywords.json",
        "nbl-stats.json",
        "bug427.json",
        "github-events.json",
        "f6a65.json",
        "7681c.json",
        "127a1.json",
        "34702.json",
        "c3303.json",
        "7f568.json",
        "26b49.json",
        "e8b04.json",
        "0a91a.json",
        "0e0c2.json",
        "0cffa.json",
    ],
    allowMissingNull: true,
    features: ["strict-optional", "enum"],
    output: "TopLevel.pmod",
    topLevel: "TopLevel",
    skipJSON: [],
    skipMiscJSON: false,
    skipSchema: [
        // no implicit cast int <-> float in Pike
        ...skipsIntFloatUnions.filter(
            (schema) =>
                schema !== "integer-float-union.schema" &&
                schema !== "union-int-double.schema",
        ),
        // all below: not failing on expected failure. That's because Pike's quite tolerant with assignments.
        ...skipsMapValueValidation.filter(
            (schema) => schema !== "go-schema-pattern-properties.schema",
        ),
        ...skipsUntypedUnions,
    ],
    rendererOptions: {},
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/Pike/index.ts"],
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
        "keywords.json",
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
        "bug855-short.json",
        "recursive.json",
        "bug427.json",
        "reddit.json",
        "github-events.json",
        "nbl-stats.json",
        "0a91a.json",
        "29f47.json",
        "2df80.json",
        "27332.json",
        "34702.json",
        "6de06.json",
        "76ae1.json",
        "af2d1.json",
        "be234.json",
        "e8b04.json",
    ],
    allowMissingNull: false,
    features: ["enum", "union", "no-defaults", "integer", "strict-optional"],
    output: "QuickType.hs",
    topLevel: "QuickType",
    skipJSON: ["combinations4.json"],
    skipMiscJSON: false,
    skipSchema: ["keyword-unions.schema"],
    rendererOptions: {},
    // The default is array-type=list; this keeps the Vector code path
    // covered.
    quickTestRendererOptions: [{ "array-type": "array" }],
    sourceFiles: ["src/language/Haskell/index.ts"],
};

export const PHPLanguage: Language = {
    name: "php",
    base: "test/fixtures/php",
    runCommand: (sample) => `php main.php "${sample}"`,
    diffViaSchema: false,
    skipDiffViaSchema: [],
    allowMissingNull: true,
    features: [
        "enum",
        "union",
        "no-defaults",
        "uuid",
        "integer",
        "minmax",
        "minmaxitems",
        "date-time",
        "minmaxlength",
    ],
    output: "TopLevel.php",
    topLevel: "TopLevel",
    skipJSON: [
        "bug863.json",
        "00c36.json",
        "2df80.json",
        "7fbfb.json",
        "c8c7e.json",
        "cda6c.json",
        "e53b5.json",
    ],
    skipMiscJSON: false,
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        // Unions are inlined as PHP union type declarations, so a
        // top-level union produces no named TopLevel class for the driver.
        "recursive-union-flattening.schema",
        // The driver does not support top-level arrays.
        "issue2680-top-level-array.schema",
    ],
    rendererOptions: {},
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/Php/index.ts"],
};

export const TypeScriptZodLanguage: Language = {
    name: "typescript-zod",
    base: "test/fixtures/typescript-zod",
    setupCommand: "npm install",
    runCommand(sample: string) {
        return `npm run --silent test "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [],
    allowMissingNull: false,
    features: [
        "enum",
        "union",
        "no-defaults",
        "date-time",
        "uuid",
        "bool-string",
        "integer-string",
        "integer",
        "minmax",
        "minmaxlength",
        "minmaxitems",
        "pattern",
        "strict-optional",
    ],
    output: "TopLevel.ts",
    topLevel: "TopLevel",
    skipJSON: [],
    skipMiscJSON: false,
    skipSchema: [],
    rendererOptions: {},
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/TypeScriptZod/index.ts"],
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
    ],
    allowMissingNull: false,
    features: [
        "enum",
        "union",
        "no-defaults",
        "integer",
        "strict-optional",
        "minmaxitems",
        "uuid",
        "minmaxlength",
        "bool-string",
        "date-time",
        "integer-string",
        "pattern",
        "minmax",
    ],
    output: "TopLevel.ts",
    topLevel: "TopLevel",
    skipJSON: [],
    skipMiscJSON: false,
    skipSchema: [],
    rendererOptions: {},
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/TypeScriptEffectSchema/index.ts"],
};

export const ElixirLanguage: Language = {
    name: "elixir",
    base: "test/fixtures/elixir",
    setupCommand: "mix deps.get",
    compileCommand: "mix compile",
    runCommand(sample: string) {
        return `mix run main.exs "${sample}"`;
    },
    diffViaSchema: true,
    skipDiffViaSchema: [
        "e53b5.json",
        "cda6c.json",
        "f22f5.json",
        "e8b04.json",
        "c8c7e.json",
        "be234.json",
        "ae7f0.json",
        "8592b.json",
        "7fbfb.json",
        "76ae1.json",
        "6de06.json",
        "4d6fb.json",
        "2df80.json",
        "29f47.json",
        "27332.json",
        "00c36.json",
        "bug863.json",
        "bug427.json",
        "keywords.json",
        "kitchen-sink.json",
        "reddit.json",
    ],
    allowMissingNull: false,
    features: ["enum", "no-defaults", "strict-optional", "integer"],
    output: "QuickType.ex",
    topLevel: "TopLevel",
    skipJSON: [
        // Some field names are too long to be expressed as atoms and some contain invalid characters.
        "blns-object.json",
    ],
    skipMiscJSON: false,
    skipSchema: [
        // The test incorrectly succeeds due to the emitter being permissive for unions that contain only primitives. A future enhancement
        // for the Elixir emitter could be a user-controlled 'strict' mode that pattern matches even on unions of only primitive types.
        // A top-level array is deserialized without enforcing its element
        // type, so a mistyped element round-trips instead of failing.
    ],
    rendererOptions: {},
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/Elixir/index.ts"],
};
