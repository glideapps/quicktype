import * as fs from "node:fs";

import {
    FetchingJSONSchemaStore,
    InputData,
    JSONSchemaInput,
    quicktype,
} from "quicktype-core";
import { describe, expect, test } from "vitest";

const schema = fs.readFileSync(
    "test/inputs/schema/recursive-ref-to-id.schema",
    "utf8",
);

async function generateTypeScript(schemaText = schema): Promise<string> {
    const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());
    await schemaInput.addSource({ name: "Tree", schema: schemaText });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "typescript" });
    return result.lines.join("\n");
}

describe("recursive JSON Schema refs to $id (issue #2836)", () => {
    test("reuses the top-level type for a self-reference", async () => {
        const output = await generateTypeScript();

        expect(output.match(/^export interface /gm)).toHaveLength(2);
        expect(output).toMatch(/children\?:\s+Tree\[\];/);
    });

    test("reuses the top-level type for an empty-fragment self-reference", async () => {
        const output = await generateTypeScript(
            schema.replace('"$ref": "T2"', '"$ref": "#"'),
        );

        expect(output.match(/^export interface /gm)).toHaveLength(2);
        expect(output).toMatch(/children\?:\s+Tree\[\];/);
    });
});
