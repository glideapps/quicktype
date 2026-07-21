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
    // The oneOf case is covered by the one-of-objects.schema fixture (with its
    // one-of-objects.2.fail.one-of.json expected-failure sample) running for
    // TypeScript/JavaScript/Flow in CI. No fixture exercises anyOf, so this
    // unit test guards that anyOf alternatives are preserved as a union rather
    // than merged into a single interface.
    test("anyOf preserves object alternatives", async () => {
        const output = await generateTypeScript("anyOf");

        expect(output).toContain("export type AssetIDEither =");
        expect(output).toContain(" | ");
        expect(output).toContain("id: number;");
        expect(output).toContain("externalId: string;");
        expect(output).not.toContain("export interface AssetIDEither");
    });
});
