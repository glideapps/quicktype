import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { expect, test } from "vitest";

test("TypeScript Zod emits unknown for unconstrained JSON Schema values", async () => {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "TopLevel",
        schema: JSON.stringify({
            type: "object",
            properties: {
                value: {},
            },
            required: ["value"],
        }),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "typescript-zod" });
    const output = result.lines.join("\n");

    expect(output).toContain("z.unknown()");
    expect(output).not.toContain("z.any()");
});
