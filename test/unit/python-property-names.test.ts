import { expect, test } from "vitest";

import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";

const schema = JSON.stringify({
    type: "object",
    properties: {
        source_m3u8: { type: "string" },
        "has-dash": { type: "string" },
    },
});

async function pythonFor(keepPropertyNames: boolean): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name: "TopLevel", schema });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "python",
        rendererOptions: {
            "keep-property-names": keepPropertyNames,
        },
    });

    return result.lines.join("\n");
}

test("Python keeps the default naming behavior", async () => {
    const output = await pythonFor(false);

    expect(output).toContain("source_m3_u8: str");
    expect(output).toContain("has_dash: str");
});

test("Python can keep valid original property names", async () => {
    const output = await pythonFor(true);

    expect(output).toContain("source_m3u8: str");
    expect(output).toContain("has_dash: str");
    expect(output).toContain('obj.get("source_m3u8")');
});
