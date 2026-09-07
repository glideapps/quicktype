import {
    InputData,
    JSONSchemaInput,
    type RendererOptions,
    quicktype,
} from "quicktype-core";
import { expect, test } from "vitest";

async function render(rendererOptions: RendererOptions = {}): Promise<string> {
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

    const result = await quicktype({
        inputData,
        lang: "typescript-zod",
        rendererOptions,
    });
    return result.lines.join("\n");
}

test("TypeScript Zod emits any for unconstrained JSON Schema values by default", async () => {
    const output = await render();

    expect(output).toContain("z.any()");
    expect(output).not.toContain("z.unknown()");
});

test("TypeScript Zod emits unknown when prefer-unknown is enabled", async () => {
    const output = await render({ "prefer-unknown": true });

    expect(output).toContain("z.unknown()");
    expect(output).not.toContain("z.any()");
});
