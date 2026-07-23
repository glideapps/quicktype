// PHP generation used to fail with "union are not supported" whenever the
// input contained a union that wasn't just nullable — e.g. a heterogeneous
// array like [1, "two", {"nested": "object"}].  Unions are now rendered
// inline as PHP 8.0 union type declarations, with runtime type dispatch in
// the from/to/validate converters.
import { describe, expect, test } from "vitest";

import {
    InputData,
    jsonInputForTargetLanguage,
    quicktype,
} from "quicktype-core";

async function phpForJSONSamples(samples: string[]): Promise<string> {
    const jsonInput = jsonInputForTargetLanguage("php");
    await jsonInput.addSource({ name: "TopLevel", samples });
    const inputData = new InputData();
    inputData.addInput(jsonInput);
    const result = await quicktype({ inputData, lang: "php" });
    return result.lines.join("\n");
}

describe("PHP union support", () => {
    test("heterogeneous arrays render with runtime dispatch", async () => {
        const php = await phpForJSONSamples([
            '{"mixed": [1, "two", true, null, {"nested": "object"}]}',
        ]);
        // Each member gets a runtime type check in the converters.
        expect(php).toMatch(/is_int\(\$value\)/);
        expect(php).toMatch(/is_string\(\$value\)/);
        expect(php).toMatch(/is_bool\(\$value\)/);
        expect(php).toMatch(/is_null\(\$value\)/);
        expect(php).toMatch(/\$value instanceof \w/);
        // Unmatched values fail loudly instead of being silently dropped.
        expect(php).toMatch(/Cannot deserialize union value/);
    });

    test("a union property gets a PHP 8 union type declaration", async () => {
        const php = await phpForJSONSamples([
            '{"v": 1}',
            '{"v": "s"}',
            '{"v": {"x": 1}}',
        ]);
        expect(php).toMatch(/private V\|int\|string \$v;/);
        expect(php).toMatch(/stdClass\|int\|string \$value/);
    });

    test("nullable unions keep the ?-prefixed hint", async () => {
        const php = await phpForJSONSamples(['{"a": "x"}', '{"a": null}']);
        expect(php).toMatch(/private \?string \$a;/);
    });

    test("a double member accepts PHP integers", async () => {
        // PHP has no union of both number types; 1 and 2.5 unify to
        // double, whose runtime check must still match int values.
        const php = await phpForJSONSamples(['{"n": [1, 2.5, "s"]}']);
        expect(php).toMatch(/is_float\(\$value\) \|\| is_int\(\$value\)/);
    });

    test("reserved words are not used as class names", async () => {
        // "mixed" is a reserved type name in PHP 8; `class Mixed` would
        // fail to compile.
        const php = await phpForJSONSamples(['{"mixed": {"a": 1}}']);
        expect(php).not.toMatch(/class Mixed\b/);
        expect(php).toMatch(/class MixedClass\b/);
    });
});
