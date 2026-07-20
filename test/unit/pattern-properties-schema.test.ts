import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";
import { expect, test } from "vitest";

const schema = JSON.stringify({
    type: "object",
    properties: {
        alternators: {
            type: "object",
            patternProperties: {
                "(^[A-Za-z0-9]+$)": {
                    type: "object",
                    properties: {
                        voltage: { type: "number" },
                        name: { type: "string" },
                    },
                },
            },
        },
    },
});

test("uses a single pattern property as the map value type", async () => {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name: "Electrical", schema });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "swift" });
    const output = result.lines.join("\n");

    expect(output).toContain("let alternators: [String: Alternator]?");
    expect(output).toContain("struct Alternator: Codable");
    expect(output).toContain("let name: String?");
    expect(output).toContain("let voltage: Double?");
    expect(output).not.toContain("JSONAny");
});
