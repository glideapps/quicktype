// Schema fixture round-trips cannot detect mangled enum identifiers: the
// generated code consistently maps them to the original JSON strings.  Assert
// on the Go identifiers directly while the matching schema fixture provides
// end-to-end compile and round-trip coverage.

import fs from "node:fs/promises";

import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { describe, expect, test } from "vitest";

const schemaPath = "test/inputs/schema/uppercase-acronym-enum.schema";
const enumValues = ["HLS", "DASH", "MSS"];

async function generateGo(): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "TopLevel",
        schema: await fs.readFile(schemaPath, "utf8"),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "go" });
    return result.lines.join("\n");
}

describe("Go custom acronym enum names", () => {
    test("keeps fully-uppercase enum values uppercase", async () => {
        const output = await generateGo();

        for (const enumValue of enumValues) {
            const declaration = output.match(
                new RegExp(
                    `^\\s*(\\w+)\\s+Format\\s*=\\s*"${enumValue}"$`,
                    "m",
                ),
            );
            expect(
                declaration,
                `generated Go output:\n${output}`,
            ).not.toBeNull();
            expect(declaration?.[1]).toBe(enumValue);
        }
    });
});
