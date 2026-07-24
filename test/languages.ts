import type { LanguageName } from "quicktype-core";

// @ts-expect-error: ../dist only exists after the root package is built
import type { RendererOptions } from "../dist/quicktype-core/Run";

const easySampleJSONs = [
    "bitcoin-block.json",
    "pokedex.json",
    "simple-object.json",
    "getting-started.json",
];

// Shared `skipSchema` lists for failure modes that many languages have in
// common.  Spread these into a language's `skipSchema` instead of repeating
// the individual entries.  When a new test schema hits one of these failure
// modes, add it to the shared list so every affected language skips it at
// once.

// The generated code does not reject invalid enum values, so the
// `.fail.enum.json` samples for these enum-bearing schemas do not fail as
// expected.  Add any new schema whose fail sample relies on enum-value
// rejection.
const skipsEnumValueValidation = [
    "enum.schema",
    "enum-large.schema",
    "optional-enum.schema",
    "const-non-string.schema",
    "haskell-enum-forbidden.schema",
    "nullable-optional-one-of.schema",
    "all-of-additional-properties-false.schema",
];

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

// The generated deserializer for a top-level array of scalars uses a
// loosely-typed container (e.g. a raw `List`, an `ArrayList<Long>` whose
// element type is erased at runtime, or an untyped decoder) that does not
// enforce the declared element type, so a top-level array whose element has
// the wrong scalar type (a string where an integer is expected) round-trips
// instead of failing.  Add any new top-level-array schema whose fail sample
// relies on rejecting a mistyped element.
const skipsArrayElementValidation = ["issue2680-top-level-array.schema"];

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
    features: ["minmax", "minmaxlength", "pattern"],
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
    skipJSON: [
        "nbl-stats.json", // See issue #823
        "empty-enum.json", // https://github.com/JamesNK/Newtonsoft.Json/issues/1687
        "31189.json", // JSON.NET doesn't accept year 0000 as 1BC, though it should
    ],
    skipMiscJSON: false,
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        "top-level-enum.schema", // The code we generate for top-level enums is incompatible with the driver
    ],
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
    ],
    output: "QuickType.cs",
    topLevel: "TopLevel",
    skipJSON: [
        "31189.json", // .NET doesn't accept year 0000 as 1BC, though it should
    ],
    skipMiscJSON: false,
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        "top-level-enum.schema", // The code we generate for top-level enums is incompatible with the driver
        // The following skips are pre-existing System.Text.Json renderer issues,
        // found when first enabling the schema fixture for this language:
        "keyword-unions.schema", // a property named "JsonSerializer" collides with System.Text.Json.JsonSerializer: CS0120
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
    features: ["enum", "union", "uuid"],
    output: "src/main/java/io/quicktype/TopLevel.java",
    topLevel: "TopLevel",
    skipJSON: [
        "identifiers.json",
        "simple-identifiers.json",
        "nst-test-suite.json",
    ],
    skipMiscJSON: false,
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        "keyword-unions.schema", // generates classes with names that are case-insensitively equal
        // The generated converter deserializes a top-level array with a raw
        // `List`, so a mistyped element round-trips instead of failing.
        ...skipsArrayElementValidation,
    ],
    rendererOptions: {},
    // The default is array-type=list; this keeps the T[] code path
    // covered.
    quickTestRendererOptions: [{ "array-type": "array" }],
    sourceFiles: ["src/language/Java/index.ts"],
};

export const JavaLanguageWithLegacyDateTime: Language = {
    ...JavaLanguage,
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        ...JavaLanguage.skipSchema,
        "date-time.schema", // Expects less strict serialization.
    ],
    skipJSON: [
        ...(JavaLanguage.skipJSON !== undefined ? JavaLanguage.skipJSON : []),
        "0a358.json", // Expects less strict serialization (optional milliseconds).
        "337ed.json", // Expects less strict serialization (optional milliseconds).
    ],
    skipMiscJSON: true, // Handles edge cases differently and does not allow optional milliseconds.
    rendererOptions: { "datetime-provider": "legacy" },
    quickTestRendererOptions: [{ "array-type": "array" }],
};

export const JavaLanguageWithLombok: Language = {
    ...JavaLanguage,
    base: "test/fixtures/java-lombok",
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
        "e8b04.json",
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
    ],
    output: "quicktype.py",
    topLevel: "TopLevel",
    skipJSON: [
        "31189.json", // year 0 is out of range
    ],
    skipMiscJSON: false,
    skipSchema: [
        "keyword-unions.schema", // Requires more than 255 arguments
    ],
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
        "f6a65.json",
    ],
    allowMissingNull: false,
    features: ["enum", "union", "no-defaults"],
    output: "module_under_test.rs",
    topLevel: "TopLevel",
    skipJSON: [],
    skipSchema: ["integer-before-number.schema"], // Python-specific union-order regression.
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
        "e8b04.json",
    ],
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        // Crystal does not handle enum mapping
        ...skipsEnumValueValidation,
        // Crystal does not support top-level primitives
        "top-level-enum.schema",
        "keyword-unions.schema",
    ],
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
        "e8b04.json",
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
        "php-mixed-union.json",
        "nbl-stats.json",
        "kitchen-sink.json",
        // Top-level scalar arrays redefine Array#to_json recursively.
        "issue2680-scalar-array.json",
    ],
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        // We don't generate a convenience method for top-level enums
        "top-level-enum.schema",
        // Top-level scalar arrays redefine Array#to_json recursively.
        "issue2680-top-level-array.schema",
    ],
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
        "2df80.json",
        "337ed.json",
        "34702.json",
        "7eb30.json",
        "e8b04.json",
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
    ],
    skipMiscJSON: false,
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        // can't differenciate empty array and nothing for optional empty array
        // (omitempty).
        "postman-collection.schema",
    ],
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
        "minmaxlength",
        "pattern",
        "enum",
        "union",
        "no-defaults",
    ],
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
        "combinations4.json",
        /* Top-level arrays of scalars store scalar values as pointers incorrectly. */
        "issue2680-scalar-array.json",
    ],
    skipMiscJSON: false,
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        /* Member names are different when generating with schema */
        "vega-lite.schema",
        /* Enum as TopLevel is not supported */
        "top-level-enum.schema",
        /* Union with Number and Integer are not supported; min/max constraints on numbers rely on the same distinction */
        ...skipsIntFloatUnions,
        /* Enum with invalid values are not checked (for the current implementation, can be added later, should abord parsing and return NULL) */
        ...skipsEnumValueValidation,
        /* Union, Map and Arrays with invalid types are not checked (for the current implementation, can be added later, should abord parsing and return NULL) */
        "boolean-subschema.schema",
        "class-with-additional.schema",
        ...skipsMapValueValidation,
        /* Top-level array elements with invalid types (e.g. a string where
         * an integer is expected) are not checked either. */
        ...skipsArrayElementValidation,
        "multi-type-enum.schema",
        "nested-intersection-union.schema",
        "prefix-items.schema",
        /* Constraints (min/max and regex) are not supported (for the current implementation, can be added later, should abord parsing and return NULL) */
        "minmaxlength.schema",
        "schema-constraints.schema",
        "optional-const-ref.schema",
        /* Same unsupported min/max, length and regex constraints, applied to optional properties */
        "optional-constraints.schema",
        "pattern.schema",
        /* Required properties absent are not checked (for the current implementation, can be added later, should abord parsing and return NULL) */
        "ie-suffix-singularization.schema",
        "intersection.schema",
        "required.schema",
        // The default-value fail sample also relies on required-property
        // enforcement, which cJSON does not do.
        "default-value.schema",
        /* Pure Any type not supported (for the current implementation, can be added later, should manage a callback to provide the final application a way to handle it at parsing and creation of cJSON) */
        "any.schema",
        "direct-union.schema",
        "optional-any.schema",
        "recursive-union-flattening.schema",
        /* Self-referential union member (a union whose member recursively
         * refers back to the enclosing object) is not supported by the
         * multi-source renderer; generation aborts. Pre-existing cJSON
         * limitation, unrelated to the Rust fixture this schema targets. */
        "rust-cycle-breaker-union.schema",
        "required-non-properties.schema",
        /* Class elements with invalid type are not checked (for the current implementation, can be added later, should abord parsing and return NULL) */
        ...skipsUntypedUnions,
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
    features: [],
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
    ],
    output: "quicktype.hpp",
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
        "combinations4.json",
    ],
    skipMiscJSON: false,
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        // uses too much memory
        "keyword-unions.schema",
        // The generated deserializer accepts non-object values when all class properties are optional.
        "nested-intersection-union.schema",
        // Recursive top-level unions produce aliases that can refer to later aliases.
        "recursive-union-flattening.schema",
    ],
    rendererOptions: {},
    quickTestRendererOptions: [
        { "code-format": "with-struct" },
        // bug2521.json has an optional string, exercising UTF conversion
        // through std::optional.
        ["bug2521.json", { wstring: "use-wstring" }],
        { "const-style": "east-const" },
        // The default is boost=false (C++17); this keeps the boost code
        // path covered.  Pinned to specific inputs because the default
        // quicktest inputs (combinations[1-4].json) are all in this
        // fixture's skipJSON, so plain-options quicktests never run for
        // C++.  unions.json exercises nulls inside unions, where the
        // boost and std optional/variant code paths differ.
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
        "blns-object.json",
        "identifiers.json",
        "keywords.json",
        "nst-test-suite.json",
        "simple-identifiers.json",
        "bug863.json",
        "reddit.json",
        "github-events.json",
        "nbl-stats.json",
        "0a91a.json",
        "0e0c2.json",
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
        "ae9ca.json",
        "af2d1.json",
        "be234.json",
        "e8b04.json",
    ],
    allowMissingNull: false,
    features: ["enum", "union", "no-defaults"],
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
        "integer-before-number.schema", // Python-specific union-order regression.
        "union-list.schema", // recursion
        "list.schema", // recursion
        "ref-remote.schema", // recursion
        "mutually-recursive.schema", // recursion
        "postman-collection.schema", // recursion
        "vega-lite.schema", // recursion
        "simple-ref.schema", // recursion
        "recursive-union-flattening.schema", // recursion
        "rust-cycle-breaker-union.schema", // recursion
        // elm/json's field decoder uses the JS `in` operator, which finds
        // inherited Object.prototype members, so an absent "constructor"
        // property decodes to the object's constructor function.
        "constructor.schema",
        "keyword-unions.schema",
        // The generated decoder accepts invalid union members because all
        // class properties decode via `Jpipe.optional`.
        "nested-intersection-union.schema",
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
        "github-events.json",
        "keywords.json",
        "0a358.json", // date-time issues
        "0a91a.json",
        "26c9c.json", // uri/string confusion
        "32d5c.json", // date-time issues
        "337ed.json",
        "34702.json",
        "54d32.json", // date-time issues
        "5eae5.json", // date-time issues
        "77392.json", // date-time issues
        "7f568.json",
        "734ad.json",
        "76ae1.json",
        "80aff.json", // date-time issues
        "9ac3b.json", // date-time issues
        "a0496.json", // date-time issues
        "b4865.json", // date-time issues
        "c8c7e.json",
        "d23d5.json", // date-time issues
        "e53b5.json",
        "e8b04.json",
        "fcca3.json",
        "f82d9.json",
        "bug863.json", // Unable to resolve reserved keyword use, "description"
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
        "null-safe.json",
    ],
    skipMiscJSON: false,
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        // The code we generate for top-level enums is incompatible with the driver
        "top-level-enum.schema",
        // This works on macOS, but on Linux one of the failure test cases doesn't fail
        ...skipsUntypedUnions,
        "required.schema",
        // The default-value fail sample also relies on required-property enforcement.
        "default-value.schema",
        "multi-type-enum.schema",
        "intersection.schema",
        ...skipsMapValueValidation,
        ...skipsEnumValueValidation,
        "date-time.schema",
        "class-with-additional.schema",
        "vega-lite.schema",
        "top-level-primitive.schema",
    ],
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
        "combinations4.json",
    ],
    skipMiscJSON: false,
    skipSchema: ["integer-before-number.schema"], // Python-specific union-order regression.
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
        "e8b04.json",
    ],
    allowMissingNull: false,
    features: ["enum", "union", "no-defaults", "strict-optional", "date-time"],
    output: "TopLevel.ts",
    topLevel: "TopLevel",
    skipJSON: [],
    skipMiscJSON: false,
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        "keyword-unions.schema", // can't handle "constructor" property
        // Pre-existing failures (this fixture is not in CI yet, and these
        // fail with unmodified master too): objects with both declared
        // properties and typed additionalProperties render as an interface
        // whose properties are not assignable to its index signature
        // (TS2411).
        "class-map-union.schema",
        "class-with-additional.schema",
        "vega-lite.schema",
    ],
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
    // FIXME: enable once TypeScript supports unions
    diffViaSchema: false,
    skipDiffViaSchema: [],
    allowMissingNull: false,
    features: ["enum", "union", "no-defaults", "strict-optional", "date-time"],
    output: "TopLevel.js",
    topLevel: "TopLevel",
    skipJSON: [],
    skipMiscJSON: false,
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        "keyword-unions.schema", // can't handle "constructor" property
    ],
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
    features: ["enum", "union", "no-defaults", "strict-optional", "date-time"],
    output: "toplevel.js",
    topLevel: "TopLevel",
    skipJSON: [
        "ed095.json",
        "bug790.json", // renderer does not support recursion
        "recursive.json", // renderer does not support recursion
        "spotify-album.json", // renderer does not support recursion
        "76ae1.json", // renderer does not support recursion
    ],
    skipSchema: [
        // The renderer does not support a bare top-level map.
        "empty-object.schema",
        "integer-before-number.schema", // Python-specific union-order regression.
    ],
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
    features: ["enum", "union", "no-defaults", "strict-optional"],
    output: "TopLevel.js",
    topLevel: "TopLevel",
    skipJSON: [],
    skipMiscJSON: false,
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        "keyword-unions.schema", // can't handle "constructor" property
    ],
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
    features: ["enum", "union", "no-defaults"],
    output: "TopLevel.scala",
    topLevel: "TopLevel",
    skipJSON: [],
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
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
    features: ["enum", "union", "no-defaults"],
    output: "TopLevel.scala",
    topLevel: "TopLevel",
    skipJSON: [],
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
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
        // The renderer does not support a bare top-level map.
        "empty-object.schema",
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
    features: ["enum", "union", "no-defaults", "date-time"],
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
        // Klaxon does not support top-level primitives
        "no-classes.json",
        // These should be enabled
        "nbl-stats.json",
        // TODO Investigate these
        "af2d1.json",
        "32431.json",
        "bug427.json",
    ],
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
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
        "direct-union.schema",
        // Some weird name collision
        "keyword-enum.schema",
        "keyword-unions.schema",
        // Klaxon does not support top-level primitives/unions
        "top-level-enum.schema",
        "top-level-primitive.schema",
        "recursive-union-flattening.schema",
        // A top-level array is deserialized without enforcing its element
        // type, so a mistyped element round-trips instead of failing.
        ...skipsArrayElementValidation,
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
        // TODO Investigate these
        "34702.json",
        "76ae1.json",
    ],
    allowMissingNull: true,
    features: ["enum", "union", "no-defaults", "date-time"],
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
        "php-mixed-union.json",
        "nst-test-suite.json",
        // Klaxon does not support top-level primitives
        "no-classes.json",
        // These should be enabled
        "nbl-stats.json",
        // TODO Investigate these
        "af2d1.json",
        "32431.json",
        "bug427.json",
    ],
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
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
        "direct-union.schema",
        // Some weird name collision
        "keyword-enum.schema",
        "keyword-unions.schema",
        // Klaxon does not support top-level primitives/unions
        "top-level-enum.schema",
        "top-level-primitive.schema",
        "recursive-union-flattening.schema",
        // Jackson cannot deserialize the generated ArrayList subclass because
        // it has no default constructor.
        "top-level-array.schema",
        "top-level-primitive-array.schema",
        // A top-level array is deserialized into an `ArrayList<Long>` whose
        // element type is erased at runtime, so a mistyped element
        // round-trips instead of failing.
        ...skipsArrayElementValidation,
    ],
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
    features: ["enum", "no-defaults", "date-time"],
    output: "TopLevel.kt",
    topLevel: "TopLevel",
    skipJSON: [
        // Top-level arrays render as `typealias TopLevel = JsonArray<T>`,
        // which doesn't compile — kotlinx's JsonArray takes no type
        // arguments (documented TODO in KotlinXRenderer.ts).
        "kotlin-enum-class-case-collision.json",
        "bug863.json",
        "github-events.json",
        "optional-union.json",
        "issue2680-object-array.json",
        "issue2680-scalar-array.json",
        "00c36.json",
        "010b1.json",
        "050b0.json",
        "06bee.json",
        "07c75.json",
        "0a91a.json",
        "10be4.json",
        "13d8d.json",
        "1a7f5.json",
        "2df80.json",
        "32d5c.json",
        "3536b.json",
        "43970.json",
        "570ec.json",
        "5eae5.json",
        "66121.json",
        "6eb00.json",
        "77392.json",
        "7f568.json",
        "7fbfb.json",
        "9847b.json",
        "996bd.json",
        "9a503.json",
        "9eed5.json",
        "a45b0.json",
        "ab0d1.json",
        "ad8be.json",
        "b4865.json",
        "c8c7e.json",
        "cda6c.json",
        "e2a58.json",
        "e53b5.json",
        "e8a0b.json",
        "e8b04.json",
        "f3139.json",
        "f3edf.json",
        "f466a.json",
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
        "php-mixed-union.json",
        "union-constructor-clash.json",
        "unions.json",
        "26c9c.json",
        "29f47.json",
        "33d2e.json",
        "421d4.json",
        "5f7fe.json",
        "617e8.json",
        "a0496.json",
        "a3d8c.json",
        "f74d5.json",
        "fcca3.json",
        // stringEscape renders astral-plane characters as `\u{5 hex digits}`,
        // which Kotlin misparses (it only supports 4-digit `\u` escapes), so
        // the @SerialName annotations don't match the JSON keys.
        "blns-object.json",
        "identifiers.json",
    ],
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        // Unions render as sealed classes without serializer wiring, so
        // deserialization fails at runtime (documented TODO in
        // KotlinXRenderer.ts).
        "accessors.schema",
        "bool-string.schema",
        "class-map-union.schema",
        "class-with-additional.schema",
        "date-time.schema",
        // The string|date-time property becomes a union once Kotlin maps
        // date-time (it was a plain string before).
        "date-time-or-string.schema",
        "description.schema",
        "direct-union.schema",
        "enum.schema", // enum.3.json contains an int|string union
        "implicit-class-array-union.schema",
        "integer-float-union.schema",
        "integer-string.schema",
        "min-max-items.schema", // unionItems is an int|string union array
        "minmaxlength.schema",
        "multi-type-enum.schema",
        "mutually-recursive.schema",
        "prefix-items.schema",
        "recursive-union-flattening.schema",
        "rust-cycle-breaker-union.schema",
        "tuple.schema",
        "union-int-double.schema",
        "union-list.schema",
        // Additionally exceeds the JVM's 255-parameter limit when the
        // serialization plugin generates the synthesized constructors.
        "keyword-unions.schema",
        // Top-level array: `typealias TopLevel = JsonArray<T>` doesn't
        // compile (documented TODO in KotlinXRenderer.ts).
        "union.schema",
        "top-level-array.schema",
        "top-level-primitive-array.schema",
        "issue2680-top-level-array.schema",
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
        "keywords.json",
    ],
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        "enum-with-null.schema",
        // Deliberately NOT ...skipsEnumValueValidation: Dart runs
        // optional-enum.schema as its own regression test (see PR #2720),
        // so only these two enum schemas are skipped.
        "enum.schema",
        "enum-large.schema",
        "const-non-string.schema",
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
        "uuid.schema",
    ],
    skipMiscJSON: true,
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
    ],
    skipMiscJSON: false,
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        "top-level-enum.schema", // output generated properly, but not a class
        "keyword-unions.schema", // seems like a problem with deserializing
        // no implicit cast int <-> float in Pike
        ...skipsIntFloatUnions,
        // all below: not failing on expected failure. That's because Pike's quite tolerant with assignments.
        ...skipsMapValueValidation,
        "class-with-additional.schema",
        "multi-type-enum.schema",
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
        "e8b04.json",
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
        "keywords.json",
    ],
    skipMiscJSON: false,
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        ...skipsUntypedUnions,
        // The test driver encodes the Maybe result, so a failed decode prints
        // "null" and exits 0 — expected-failure samples cannot be detected.
        // (A top-level `[Int]` correctly fails to decode `[1, 2, "three"]`,
        // but the driver still exits 0.)
        "boolean-subschema.schema",
        "issue2680-top-level-array.schema",
        "nested-intersection-union.schema",
        "prefix-items.schema",
        "direct-union.schema",
        "empty-object.schema",
        ...skipsEnumValueValidation,
        ...skipsMapValueValidation,
        "intersection.schema",
        "multi-type-enum.schema",
        "keyword-unions.schema",
        "optional-any.schema",
        "ie-suffix-singularization.schema",
        "required.schema",
        // The default-value fail sample also relies on required-property enforcement.
        "default-value.schema",
        "required-non-properties.schema",
    ],
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
    features: ["enum", "uuid"],
    output: "TopLevel.php",
    topLevel: "TopLevel",
    includeJSON: [
        ...easySampleJSONs,
        "uuids.json",
        "nested-objects.json",
        "bug2663.json",
        // Union-heavy inputs: PHP renders non-nullable unions as inline
        // PHP 8.0 union type declarations with runtime dispatch.
        "unions.json",
        "union-constructor-clash.json",
        "combinations1.json",
        "combinations2.json",
        "combinations3.json",
        "combinations4.json",
        "nst-test-suite.json",
        "kitchen-sink.json",
        "list.json",
        "bug427.json",
        // The motivating repro for non-nullable union support: a
        // heterogeneous array under a PHP-reserved-word property name.
        "php-mixed-union.json",
        "php-validation.json",
    ],
    skipMiscJSON: true,
    skipSchema: [
        // The renderer does not support a bare top-level map.
        "empty-object.schema",
        "integer-before-number.schema", // Python-specific union-order regression.
        // PHP class names are case-insensitive, but the namer dedups
        // case-sensitively, so this declares classes that collide (same
        // reason Java and Python skip it).
        "keyword-unions.schema",
        // Unions are inlined as PHP union type declarations, so a
        // top-level union produces no named TopLevel class for the driver.
        "recursive-union-flattening.schema",
        // The generated code for top-level enums is incompatible with the
        // driver.
        "top-level-enum.schema",
        // The driver does not support top-level arrays.
        "union.schema",
        "top-level-array.schema",
        "top-level-primitive-array.schema",
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
        "e8b04.json",
    ],
    allowMissingNull: false,
    features: ["enum", "union", "no-defaults", "date-time", "minmaxitems"],
    output: "TopLevel.ts",
    topLevel: "TopLevel",
    skipJSON: [
        // The test driver can't find the top-level schema among the
        // prefixed names (FluffyTopLevelSchema etc.)
        "2df80.json",

        // z.coerce.date() serializes timestamps with milliseconds, the
        // input has none
        "github-events.json",

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
        "bug427.json",
        "nst-test-suite.json",
        "keywords.json",
        "ed095.json",
        "32d5c.json",
    ],
    skipMiscJSON: false,
    skipSchema: [
        // The renderer does not support a bare top-level map.
        "empty-object.schema",
        "integer-before-number.schema", // Python-specific union-order regression.
        "any.schema",
        ...skipsUntypedUnions,
        "direct-union.schema",
        ...skipsEnumValueValidation,
        // zod validates the inherited Object.prototype.constructor when an
        // optional "constructor" property is absent
        "constructor.schema",
        // z.coerce.date() serializes back as ISO UTC, not the input string
        "date-time.schema",
        ...skipsMapValueValidation,
        "intersection.schema",
        "multi-type-enum.schema",
        "keyword-unions.schema",
        "optional-any.schema",
        "recursive-union-flattening.schema",
        "required.schema",
        // The default-value fail sample also relies on required-property enforcement.
        "default-value.schema",
        "required-non-properties.schema",
    ],
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
        "e8b04.json",
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

        // Does not handle top level arrays
        "bug863.json",
        "issue2680-scalar-array.json",

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
    ],
    skipMiscJSON: false,
    skipSchema: [
        // The renderer does not support a bare top-level map.
        "empty-object.schema",
        "integer-before-number.schema", // Python-specific union-order regression.
        "any.schema",
        ...skipsUntypedUnions,
        "direct-union.schema",
        ...skipsEnumValueValidation,
        ...skipsMapValueValidation,
        "intersection.schema",
        "multi-type-enum.schema",
        "keyword-unions.schema",
        "optional-any.schema",
        "required.schema",
        // The default-value fail sample also relies on required-property enforcement.
        "default-value.schema",
        "required-non-properties.schema",
        "issue2680-top-level-array.schema",
    ],
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
        "34702.json",
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
    features: ["enum", "no-defaults", "strict-optional"],
    output: "QuickType.ex",
    topLevel: "TopLevel",
    skipJSON: [
        // Some field names are too long to be expressed as atoms and some contain invalid characters.
        "blns-object.json",
        // A top-level array of scalars generates a TopLevel that maps
        // `TopLevelElement.from_map/1` over the elements, but no
        // `TopLevelElement` module is emitted for a scalar element type, so
        // the program raises UndefinedFunctionError at runtime. (A top-level
        // array of objects works because that module is emitted.)
        "issue2680-scalar-array.json",
    ],
    skipMiscJSON: false,
    skipSchema: [
        "integer-before-number.schema", // Python-specific union-order regression.
        // The error occurs because a guard clause that references TopLevel is compiled before TopLevel itself. To fix this, put
        // TopLevel before Bar, but this doesn't address the actual problem if for example a pattern match to Bar was in TopLevel.
        "mutually-recursive.schema",

        // Struct keys cannot be enforced at runtime in Elixir and their values will just be set to null.
        "ie-suffix-singularization.schema",
        "strict-optional.schema",
        "required.schema",
        // The default-value fail sample also relies on required-property enforcement.
        "default-value.schema",
        // The renderer references a nonexistent TopLevelElement module for
        // top-level arrays.
        "top-level-array.schema",
        "top-level-primitive-array.schema",
        "boolean-subschema.schema",
        "intersection.schema",
        "optional-any.schema",

        // The test incorrectly succeeds due to the emitter being permissive for unions that contain only primitives. A future enhancement
        // for the Elixir emitter could be a user-controlled 'strict' mode that pattern matches even on unions of only primitive types.
        ...skipsMapValueValidation,

        // A bare top-level map is emitted as a Jason.decode!/encode! pass-through
        // with no shape validation, so the .fail.json case (a non-object) is not
        // rejected and round-trips instead of exiting nonzero. Same permissiveness
        // class as go-schema-pattern-properties above.
        "empty-object.schema",

        // The generated top-level type is not emitted as a TopLevel module the fixture can call.
        "recursive-union-flattening.schema",

        // A top-level array is deserialized without enforcing its element
        // type, so a mistyped element round-trips instead of failing.
        ...skipsArrayElementValidation,
    ],
    rendererOptions: {},
    quickTestRendererOptions: [],
    sourceFiles: ["src/language/Elixir/index.ts"],
};
