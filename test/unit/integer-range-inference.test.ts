// A whole number in input JSON that lies outside the target language's
// integer range must be inferred as `double`, not `integer` — the integer
// type could not round-trip it, so the generated code would fail on the
// very sample it was generated from.  The range is language-specific: most
// languages use 64-bit integers, JavaScript and its relatives are only
// exact within ±(2^53 - 1), and languages like Python have
// arbitrary-precision integers with no limit at all.
// See https://github.com/glideapps/quicktype/issues/2931.
//
// The CLI parses JSON with a streaming parser that never materializes the
// number as a JavaScript value, so the range check has to work on the digit
// string; JS numbers cannot represent int64 boundary values exactly.
import { DefaultDateTimeRecognizer } from "quicktype-core/dist/DateTime.js";
import stringToStream from "string-to-stream";
import { describe, expect, test } from "vitest";

import {
    INT16_RANGE,
    INT32_RANGE,
    INT64_RANGE,
    InputData,
    type IntegerRange,
    JSONInput,
    JS_SAFE_INTEGER_RANGE,
    type LanguageName,
    integerStringInRange,
    jsonInputForTargetLanguage,
    languageNamed,
    quicktype,
} from "quicktype-core";

import { CompressedJSONFromStream } from "../../src/CompressedJSONFromStream";

describe("integerStringInRange", () => {
    test("accepts values inside the int64 range", () => {
        expect(integerStringInRange("0", INT64_RANGE)).toBe(true);
        expect(integerStringInRange("-0", INT64_RANGE)).toBe(true);
        expect(integerStringInRange("1", INT64_RANGE)).toBe(true);
        expect(integerStringInRange("-1", INT64_RANGE)).toBe(true);
        expect(integerStringInRange("123456789", INT64_RANGE)).toBe(true);
        // INT64_MAX and INT64_MIN are still integers.
        expect(integerStringInRange("9223372036854775807", INT64_RANGE)).toBe(
            true,
        );
        expect(integerStringInRange("-9223372036854775808", INT64_RANGE)).toBe(
            true,
        );
    });

    test("ignores leading zeros", () => {
        expect(
            integerStringInRange("00000000000000000000042", INT64_RANGE),
        ).toBe(true);
        expect(
            integerStringInRange("-00000000000000000000042", INT64_RANGE),
        ).toBe(true);
        expect(integerStringInRange("009223372036854775807", INT64_RANGE)).toBe(
            true,
        );
        expect(integerStringInRange("009223372036854775808", INT64_RANGE)).toBe(
            false,
        );
    });

    test("rejects values just outside the int64 range", () => {
        expect(integerStringInRange("9223372036854775808", INT64_RANGE)).toBe(
            false,
        );
        expect(integerStringInRange("-9223372036854775809", INT64_RANGE)).toBe(
            false,
        );
    });

    test("rejects values far outside the int64 range", () => {
        expect(
            integerStringInRange("123456789012345678901234567890", INT64_RANGE),
        ).toBe(false);
        expect(
            integerStringInRange(
                "-123456789012345678901234567890",
                INT64_RANGE,
            ),
        ).toBe(false);
    });

    test("the JS safe-integer range is narrower than int64", () => {
        expect(
            integerStringInRange("9007199254740991", JS_SAFE_INTEGER_RANGE),
        ).toBe(true);
        expect(
            integerStringInRange("9007199254740992", JS_SAFE_INTEGER_RANGE),
        ).toBe(false);
        expect(
            integerStringInRange("-9007199254740991", JS_SAFE_INTEGER_RANGE),
        ).toBe(true);
        expect(
            integerStringInRange("-9007199254740992", JS_SAFE_INTEGER_RANGE),
        ).toBe(false);
    });
});

// Mirror how the CLI wires up JSON input (jsonInputForTargetLanguage in
// src/index.ts): the streaming CompressedJSON parser is where integer
// vs. double classification happens, using the target language's range.
async function streamedLinesForJSON(
    lang: LanguageName,
    json: string,
    range: IntegerRange | null,
): Promise<string> {
    const compressedJSON = new CompressedJSONFromStream(
        new DefaultDateTimeRecognizer(),
        false,
        range,
    );
    const input = new JSONInput(compressedJSON);
    await input.addSource({ name: "Edge", samples: [stringToStream(json)] });
    const inputData = new InputData();
    inputData.addInput(input);
    const result = await quicktype({ inputData, lang });
    return result.lines.join("\n");
}

function rangeForLanguage(lang: LanguageName): IntegerRange | null {
    const language = languageNamed(lang);
    if (language === undefined) {
        throw new Error(`no such language: ${lang}`);
    }

    return language.getSupportedIntegerRange();
}

describe("language-declared integer ranges", () => {
    test("Crystal renders integers as Int32, so its range is int32", () => {
        expect(rangeForLanguage("crystal")).toEqual(INT32_RANGE);
    });

    test("Elm's Int is a JavaScript number at runtime", () => {
        expect(rangeForLanguage("elm")).toEqual(JS_SAFE_INTEGER_RANGE);
    });

    test("cJSON's range follows the integer-size renderer option", () => {
        const cjson = languageNamed("cjson");
        if (cjson === undefined) throw new Error("no such language: cjson");
        expect(cjson.getSupportedIntegerRange()).toEqual(INT64_RANGE);
        expect(
            cjson.getSupportedIntegerRange({ "integer-size": "int16_t" }),
        ).toEqual(INT16_RANGE);
    });
});

describe("streaming inference of numbers at the integer-range boundary", () => {
    test("Go: out-of-range whole numbers become float64, INT64_MAX stays int64", async () => {
        const lines = await streamedLinesForJSON(
            "go",
            '{"big": 9223372036854775807, "bigger": 123456789012345678901234567890}',
            rangeForLanguage("go"),
        );
        expect(lines).toMatch(/Big\s+\*?int64/);
        expect(lines).toMatch(/Bigger\s+\*?float64/);
    });

    test("Go: INT64_MIN stays int64, one below becomes float64", async () => {
        const lines = await streamedLinesForJSON(
            "go",
            '{"min": -9223372036854775808, "smaller": -9223372036854775809}',
            rangeForLanguage("go"),
        );
        expect(lines).toMatch(/Min\s+\*?int64/);
        expect(lines).toMatch(/Smaller\s+\*?float64/);
    });

    test("Crystal: whole numbers beyond Int32 become Float64", async () => {
        const lines = await streamedLinesForJSON(
            "crystal",
            '{"fits": 2147483647, "overflows": 2147483648}',
            rangeForLanguage("crystal"),
        );
        expect(lines).toMatch(/fits.*Int32/);
        expect(lines).toMatch(/overflows.*Float64/);
    });

    test("Python: arbitrary-precision integers never overflow to float", async () => {
        const lines = await streamedLinesForJSON(
            "python",
            '{"huge": 123456789012345678901234567890}',
            rangeForLanguage("python"),
        );
        expect(lines).toMatch(/huge:\s+int/);
        expect(lines).not.toMatch(/huge:\s+float/);
    });

    // The same literal classifies differently under different ranges; the
    // Python renderer distinguishes int from float, which makes the
    // classification visible in the output.
    test("the range is what decides, not the language's renderer", async () => {
        const literal = '{"n": 9007199254740993}'; // 2^53 + 1: in int64, outside JS-safe

        const asInt64 = await streamedLinesForJSON(
            "python",
            literal,
            INT64_RANGE,
        );
        expect(asInt64).toMatch(/n:\s+int/);

        const asJsSafe = await streamedLinesForJSON(
            "python",
            literal,
            JS_SAFE_INTEGER_RANGE,
        );
        expect(asJsSafe).toMatch(/n:\s+float/);
    });
});

describe("core (JSON.parse-based) inference at the integer-range boundary", () => {
    async function coreLinesForJSON(
        lang: LanguageName,
        json: string,
        rendererOptions: Record<string, unknown> = {},
    ): Promise<string> {
        const jsonInput = jsonInputForTargetLanguage(
            lang,
            undefined,
            false,
            rendererOptions,
        );
        await jsonInput.addSource({ name: "Edge", samples: [json] });
        const inputData = new InputData();
        inputData.addInput(jsonInput);
        const result = await quicktype({ inputData, lang, rendererOptions });
        return result.lines.join("\n");
    }

    test("Go: whole numbers between 2^53 and INT64_MAX stay int64", async () => {
        // 2^63 - 1024, the largest double below INT64_MAX.
        const lines = await coreLinesForJSON(
            "go",
            '{"big": 9223372036854774784, "bigger": 123456789012345678901234567890}',
        );
        expect(lines).toMatch(/Big\s+\*?int64/);
        expect(lines).toMatch(/Bigger\s+\*?float64/);
    });

    test("Python: huge whole numbers stay int", async () => {
        const lines = await coreLinesForJSON(
            "python",
            '{"huge": 123456789012345678901234567890}',
        );
        expect(lines).toMatch(/huge:\s+int/);
    });

    test("cJSON: the integer-size option narrows the inferred range", async () => {
        const json = '{"n": 32768}'; // fits int64_t, not int16_t

        const asDefault = await coreLinesForJSON("cjson", json);
        expect(asDefault).toMatch(/int64_t\s+\*?n/);

        const asInt16 = await coreLinesForJSON("cjson", json, {
            "integer-size": "int16_t",
        });
        expect(asInt16).toMatch(/double\s+\*?n/);
        expect(asInt16).not.toMatch(/int16_t\s+\*?n/);
    });
});
