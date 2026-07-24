// A top-level empty-object schema is inferred as a map.  The schema fixture
// exercises its generated converters, but those converters inline the map
// type, so they still compile when the public top-level alias is missing.
// Assert the declaration itself here to prevent that regression.

import {
    InputData,
    JSONSchemaInput,
    type LanguageName,
    quicktype,
} from "quicktype-core";
import { describe, expect, test } from "vitest";

async function renderSchema(
    lang: LanguageName,
    name: string,
    schema: object,
): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name, schema: JSON.stringify(schema) });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang,
        rendererOptions: { "just-types": true },
    });
    return result.lines.join("\n");
}

const emptyObjectSchema = {
    $schema: "http://json-schema.org/draft-06/schema#",
    type: "object",
    properties: {},
};

describe("TypeScript/Flow unnamed top-level aliases", () => {
    test.each([
        ["typescript", "unknown"],
        ["flow", "mixed"],
    ] as const)("%s emits an empty-object map alias", async (lang, anyType) => {
        const output = await renderSchema(
            lang,
            "EmptySchema",
            emptyObjectSchema,
        );

        expect(output).toContain(
            `export type EmptySchema = { [key: string]: ${anyType} };`,
        );
    });

    test.each([
        "typescript",
        "flow",
    ] as const)("%s does not alias a map whose value type claims the top-level name", async (lang) => {
        const output = await renderSchema(lang, "TopLevel", {
            type: "object",
            additionalProperties: {
                type: "object",
                properties: {
                    one: { type: "integer" },
                    two: { type: "boolean" },
                },
                required: ["one", "two"],
            },
        });
        const declarations =
            output.match(/export (?:type|interface) TopLevel\b/g) ?? [];

        expect(declarations).toHaveLength(1);
    });
});
