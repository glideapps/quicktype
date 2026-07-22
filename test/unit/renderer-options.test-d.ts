// Type-level tests: `rendererOptions` keys and values are validated by the
// type system against the target language given in `lang`.  When `lang` is
// a string literal, `quicktype` infers it and unknown option names or
// invalid enum values are compile errors — there is no runtime validation.
// See https://github.com/glideapps/quicktype/issues/2933.
import { describe, test } from "vitest";

import {
    InputData,
    type LanguageName,
    quicktype,
    quicktypeMultiFile,
} from "../../packages/quicktype-core/src/index.js";

const inputData = new InputData();

describe("rendererOptions typing", () => {
    test("accepts a language's own options", () => {
        void quicktype({
            inputData,
            lang: "csharp",
            rendererOptions: {
                namespace: "Acme",
                framework: "SystemTextJson",
                "csharp-version": "6",
            },
        });
    });

    test("boolean options accept booleans and their string forms", () => {
        void quicktype({
            inputData,
            lang: "typescript",
            rendererOptions: { "just-types": true },
        });
        void quicktype({
            inputData,
            lang: "typescript",
            rendererOptions: { "just-types": "true" },
        });
    });

    test("rejects an unknown option name", () => {
        void quicktype({
            inputData,
            lang: "typescript",
            // @ts-expect-error unknown option name
            rendererOptions: { "totally-bogus-option": "yes" },
        });
    });

    test("rejects another language's option name", () => {
        void quicktype({
            inputData,
            lang: "rust",
            // @ts-expect-error Rust has no `just-types` option
            rendererOptions: { "just-types": "true" },
        });
    });

    test("rejects an invalid enum option value", () => {
        void quicktype({
            inputData,
            lang: "csharp",
            // @ts-expect-error GSON is not a C# serialization framework
            rendererOptions: { framework: "GSON" },
        });
    });

    test("quicktypeMultiFile enforces the same typing", () => {
        void quicktypeMultiFile({
            inputData,
            lang: "csharp",
            // @ts-expect-error unknown option name
            rendererOptions: { "totally-bogus-option": "yes" },
        });
    });

    test("stays permissive when the language is not a literal", () => {
        // Callers that don't pin `lang` to a literal — or omit it — keep
        // the old, unchecked behavior.
        const lang: LanguageName = "csharp" as LanguageName;
        void quicktype({
            inputData,
            lang,
            rendererOptions: { "just-types": "true" },
        });
        void quicktype({ inputData, rendererOptions: {} });
    });
});
