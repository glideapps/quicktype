import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { expect, test } from "vitest";

async function render(preferConstValues: boolean): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "TopLevel",
        schema: JSON.stringify({
            type: "object",
            properties: {
                kind: { type: "string", enum: ["only"] },
            },
            required: ["kind"],
        }),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "typescript-zod",
        rendererOptions: { "prefer-const-values": preferConstValues },
    });
    return result.lines.join("\n");
}

test("TypeScript Zod emits a literal for a single-value enum when preferred", async () => {
    const output = await render(true);

    expect(output).toContain('z.literal("only")');
    expect(output).not.toContain("z.enum([");
});

test("TypeScript Zod emits an enum for a single-value enum by default", async () => {
    expect(await render(false)).toContain("z.enum([");
});
