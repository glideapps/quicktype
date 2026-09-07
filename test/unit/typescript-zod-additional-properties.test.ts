import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { expect, test } from "vitest";

test("TypeScript Zod preserves JSON Schema additionalProperties semantics", async () => {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "TopLevel",
        schema: JSON.stringify({
            type: "object",
            properties: {
                strict: {
                    type: "object",
                    properties: { value: { type: "string" } },
                    additionalProperties: false,
                },
                loose: {
                    type: "object",
                    properties: { value: { type: "string" } },
                    additionalProperties: true,
                },
                typed: {
                    type: "object",
                    properties: { value: { type: "string" } },
                    additionalProperties: { type: "boolean" },
                },
            },
            required: ["strict", "loose", "typed"],
            additionalProperties: false,
        }),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "typescript-zod" });
    const output = result.lines.join("\n");

    expect(output).toContain(".strict()");
    expect(output).toContain(".passthrough()");
    expect(output).toContain(".catchall(z.boolean())");
});
