import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";
import { expect, test } from "vitest";

const schema = JSON.stringify({
    $schema: "http://json-schema.org/draft-04/schema#",
    title: "Test",
    type: "object",
    properties: {
        errorCode: {
            type: "string",
            enum: ["B", "A", "E"],
        },
    },
});

test("preserves JSON Schema enum case order", async () => {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name: "Test", schema });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "c++" });

    expect(result.lines).toContain(
        "    enum class ErrorCode : int { B, A, E };",
    );
});
