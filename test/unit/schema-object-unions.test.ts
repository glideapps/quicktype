import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { describe, expect, test } from "vitest";

async function generateTypeScript(
    operation: "oneOf" | "anyOf",
): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "AssetIDEither",
        schema: JSON.stringify({
            [operation]: [
                {
                    type: "object",
                    required: ["id"],
                    properties: { id: { type: "integer" } },
                },
                {
                    type: "object",
                    required: ["externalId"],
                    properties: { externalId: { type: "string" } },
                },
            ],
        }),
    });

    const inputData = new InputData();
    inputData.addInput(schemaInput);
    const result = await quicktype({
        inputData,
        lang: "typescript",
        rendererOptions: { "just-types": true },
    });
    return result.lines.join("\n");
}

describe("JSON Schema object unions (issue #1266)", () => {
    test.each([
        "oneOf",
        "anyOf",
    ] as const)("%s preserves object alternatives", async (operation) => {
        const output = await generateTypeScript(operation);

        expect(output).toContain("export type AssetIDEither =");
        expect(output).toContain(" | ");
        expect(output).toContain("id: number;");
        expect(output).toContain("externalId: string;");
        expect(output).not.toContain("export interface AssetIDEither");
    });
});
