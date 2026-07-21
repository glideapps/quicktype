import { expect, test } from "vitest";

import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";

async function renderTypeScriptSchema(definitions: object): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "",
        schema: JSON.stringify({ definitions }),
        uris: ["#/definitions/"],
        isConverted: true,
    });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "rust" });
    return result.lines.join("\n");
}

// TypeScript inputs without a #TopLevel marker use #/definitions/ as their
// source URI.  If the compiler did not produce any definitions, the renderer
// receives no top levels and must still emit Rust without crashing.
test("Rust renders TypeScript schemas with no top levels", async () => {
    const output = await renderTypeScriptSchema({});

    expect(output).toContain("use serde::{Serialize, Deserialize};");
});

test("Rust still renders named TypeScript schema definitions", async () => {
    const output = await renderTypeScriptSchema({
        Person: {
            type: "object",
            properties: { age: { type: "integer" } },
            required: ["age"],
        },
    });

    expect(output).toContain("pub struct Person");
});
