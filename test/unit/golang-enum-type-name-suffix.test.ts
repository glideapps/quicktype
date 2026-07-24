import { describe, expect, test } from "vitest";

import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";

async function renderGo(enumTypeNameSuffix: boolean): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "TreePart",
        schema: JSON.stringify({
            type: "string",
            enum: ["BARK", "LEAF", "ROOT"],
        }),
    });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "go",
        rendererOptions: {
            "enum-type-name-suffix": enumTypeNameSuffix,
        },
    });
    return result.lines.join("\n");
}

describe("Go enum-type-name-suffix", () => {
    test("appends the enum type name to each constant when enabled", async () => {
        const output = await renderGo(true);

        expect(output).toMatch(/BarkTreePart\s+TreePart = "BARK"/);
        expect(output).toMatch(/LeafTreePart\s+TreePart = "LEAF"/);
        expect(output).toMatch(/RootTreePart\s+TreePart = "ROOT"/);
    });
});
