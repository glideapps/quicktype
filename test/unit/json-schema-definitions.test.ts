import {
    FetchingJSONSchemaStore,
    InputData,
    JSONSchemaInput,
    quicktype,
} from "quicktype-core";
import { expect, test } from "vitest";

const lightSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $defs: {
        LightParams: {
            type: "object",
            properties: {
                outlet_id: { type: "string" },
                app_id: { type: "string" },
                rgba: { type: "string" },
            },
            additionalProperties: false,
            required: ["outlet_id", "app_id", "rgba"],
        },
    },
    type: "object",
    properties: {
        LightParams: { $ref: "#/$defs/LightParams" },
    },
    additionalProperties: false,
    required: ["LightParams"],
};

test("a type under $defs keeps its definition name (issue #2778)", async () => {
    const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());
    await schemaInput.addSource({
        name: "LightSchema",
        schema: JSON.stringify(lightSchema),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "typescript",
        rendererOptions: { "just-types": "true" },
    });
    const output = result.lines.join("\n");

    // The fixture exercises this schema end-to-end, but generated symbol names
    // are not observable at runtime, so assert the regression here.
    expect(output).toContain("LightParams: LightParams;");
    expect(output).toContain("export interface LightParams {");
});
