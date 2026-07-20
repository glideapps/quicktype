import { readFile } from "node:fs/promises";

import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { describe, expect, test } from "vitest";

async function generateGo(schema: string): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name: "TopLevel", schema });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "go" });
    return result.lines.join("\n");
}

describe("enum schema identity", () => {
    test("keeps enums with distinct given names separate", async () => {
        const schema = await readFile(
            "test/inputs/schema/distinct-named-enums.schema",
            "utf8",
        );
        const output = await generateGo(schema);

        expect(output).toContain("First  *FirstEnumeration");
        expect(output).toContain("Second *SecondEnumeration");
        expect(output).toContain("type FirstEnumeration string");
        expect(output).toContain("type SecondEnumeration string");
    });

    test("deduplicates unnamed enums with identical cases", async () => {
        const output = await generateGo(
            JSON.stringify({
                type: "object",
                properties: {
                    first: { type: "string", enum: ["a", "b", "c"] },
                    second: { type: "string", enum: ["a", "b", "c"] },
                },
            }),
        );

        expect(output.match(/^type .* string$/gm)).toHaveLength(1);
    });
});
