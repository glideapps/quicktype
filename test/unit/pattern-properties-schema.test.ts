// End-to-end coverage lives in the automatically discovered fixture
// `test/inputs/schema/pattern-properties-value.schema`.  Fixture execution
// cannot distinguish a typed map value from an `any` value, so assert the
// generated value class directly here.

import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";
import { expect, test } from "vitest";

const schema = JSON.stringify({
    type: "object",
    properties: {
        materials: {
            type: "object",
            patternProperties: {
                "^.*\\S.*$": {
                    type: "object",
                    properties: {
                        roughness: { type: "string" },
                        thickness: { type: "number" },
                    },
                    required: ["roughness", "thickness"],
                },
            },
        },
    },
    required: ["materials"],
});

test("patternProperties schemas type map values (issue #1854)", async () => {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name: "Pattern", schema });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "csharp",
        rendererOptions: { framework: "SystemTextJson" },
    });
    const output = result.lines.join("\n");

    expect(output).toContain("Dictionary<string, Material> Materials");
    expect(output).toContain("public partial class Material");
    expect(output).toContain("public string Roughness");
    expect(output).toContain("public double Thickness");
});
