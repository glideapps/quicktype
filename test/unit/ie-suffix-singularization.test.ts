// Regression test for issue #1867: inferred array item names ending in `-ie`
// must not be changed to a `-y` suffix while singularizing the property name.
//
// End-to-end coverage lives in the fixture test
// `test/inputs/schema/ie-suffix-singularization.schema`.  The fixture harness
// cannot catch the misspelling because generated identifiers are internally
// consistent, so this test asserts on the emitted identifier itself.

import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { describe, expect, test } from "vitest";

const schema = JSON.stringify({
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
        cookies: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    value: { type: "string" },
                },
                required: ["name", "value"],
            },
        },
    },
    required: ["cookies"],
});

async function generateTypeScript(): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name: "TopLevel", schema });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "typescript" });
    return result.lines.join("\n");
}

describe("JSON Schema -ie suffix singularization (issue #1867)", () => {
    test("singularizes cookies to Cookie, not Cooky", async () => {
        const output = await generateTypeScript();

        expect(output).toMatch(/interface Cookie\b/);
        expect(output).not.toMatch(/interface Cooky\b/);
    });
});
