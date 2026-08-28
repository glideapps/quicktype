import { expect, test } from "vitest";

import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";

async function rubyForSchema(schema: object): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "TopLevel",
        schema: JSON.stringify(schema),
    });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "ruby" });
    return result.lines.join("\n");
}

test("Ruby only generates enum parsing helpers for top-level enums", async () => {
    const output = await rubyForSchema({
        type: "object",
        properties: {
            status: { type: "string", enum: ["ready", "waiting"] },
        },
        required: ["status"],
    });

    expect(output.match(/def self\.from_dynamic!/g)).toHaveLength(1);
    expect(output.match(/def self\.from_json!/g)).toHaveLength(1);
});
