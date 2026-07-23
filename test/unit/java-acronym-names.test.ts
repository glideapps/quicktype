// Java enum constants must keep acronyms uppercase for every --acronym-style
// setting. They are rendered in UPPER_UNDERSCORE style, but before the fix in
// https://github.com/glideapps/quicktype/pull/2851 (issue #2850) the
// acronym-style option was still applied to words recognized as acronyms
// (e.g. "SPA"), so with --acronym-style=camel the JSON enum value
// "MULTI_SPA_IN_GROUP_REJECTED" produced the constant
// "MULTI_Spa_IN_GROUP_REJECTED" (and "MULTI_spa_IN_GROUP_REJECTED" with
// lowerCase).
//
// The fixture harness cannot catch this: the mangled constants are
// self-consistent identifiers, so the generated code still compiles, and
// (de)serialization uses the raw JSON names, so round-tripping succeeds.
// This test instead generates Java code directly and asserts on the emitted
// *identifier*. Note that we must NOT just check that the output contains
// "MULTI_SPA_IN_GROUP_REJECTED" — the raw JSON name always appears in the
// string literals of toValue()/forValue(), even when the identifier is
// mangled.

import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { describe, expect, test } from "vitest";

// "spa" is a known acronym (see Acronyms.const.ts), so acronym styling would
// apply to the SPA word if the fix regressed.
const enumValue = "MULTI_SPA_IN_GROUP_REJECTED";
const schema = JSON.stringify({
    $schema: "http://json-schema.org/draft-06/schema#",
    type: "object",
    properties: {
        messageCode: {
            type: "string",
            enum: [enumValue],
        },
    },
    required: ["messageCode"],
});

async function javaEnumConstantIdentifier(
    acronymStyle: string,
): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name: "TopLevel", schema });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "java",
        rendererOptions: { "acronym-style": acronymStyle },
    });
    const output = result.lines.join("\n");
    // Matches e.g. `case MULTI_SPA_IN_GROUP_REJECTED: return "MULTI_SPA_IN_GROUP_REJECTED";`
    // in the generated MessageCode.toValue() — the capture is the identifier.
    const match = output.match(
        new RegExp(`case (\\w+): return "${enumValue}";`),
    );

    // biome-ignore lint/suspicious/noMisplacedAssertion: helper is only called from within tests
    expect(match, `generated Java output:\n${output}`).not.toBeNull();
    return match?.[1] ?? "";
}

describe("Java enum acronym casing", () => {
    test.each([
        "original",
        "pascal",
        "camel",
        "lowerCase",
    ])("keeps acronyms uppercase with acronym-style=%s", async (acronymStyle) => {
        await expect(javaEnumConstantIdentifier(acronymStyle)).resolves.toBe(
            enumValue,
        );
    });
});
