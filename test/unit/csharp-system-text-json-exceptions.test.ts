import { describe, expect, test } from "vitest";

import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";

async function renderSystemTextJsonCSharp(schema: object): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "TopLevel",
        schema: JSON.stringify(schema),
    });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "csharp",
        rendererOptions: { framework: "SystemTextJson" },
    });
    return result.lines.join("\n");
}

describe("C# System.Text.Json converters", () => {
    test("throw serializer-supported exceptions for union conversion failures", async () => {
        const output = await renderSystemTextJsonCSharp({
            type: "object",
            properties: {
                mixed: { oneOf: [{ type: "integer" }, { type: "string" }] },
            },
            required: ["mixed"],
        });

        expect(output).toContain(
            'throw new JsonException("Cannot unmarshal type Mixed");',
        );
        expect(output).toContain(
            'throw new NotSupportedException("Cannot marshal type Mixed");',
        );
        expect(output).not.toContain("throw new Exception(");
    });
});
