import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { describe, expect, test } from "vitest";

const schema = JSON.stringify({
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
        input: {
            type: "array",
            items: {
                oneOf: [
                    { $ref: "#/definitions/Message" },
                    { $ref: "#/definitions/Item" },
                ],
            },
        },
    },
    definitions: {
        Message: {
            type: "object",
            properties: { content: { type: "string" } },
            required: ["content"],
        },
        Item: {
            oneOf: [
                { $ref: "#/definitions/FunctionOutput" },
                { $ref: "#/definitions/ReasoningItem" },
            ],
        },
        FunctionOutput: {
            allOf: [
                { $ref: "#/definitions/BaseItem" },
                {
                    type: "object",
                    properties: { output: { type: "string" } },
                    required: ["output"],
                },
            ],
        },
        BaseItem: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
        },
        ReasoningItem: {
            type: "object",
            properties: { summary: { type: "string" } },
            required: ["summary"],
        },
    },
});

describe("nested intersections in unions", () => {
    test("flattens an array item union containing an indirect allOf", async () => {
        const schemaInput = new JSONSchemaInput(undefined);
        await schemaInput.addSource({ name: "TopLevel", schema });
        const inputData = new InputData();
        inputData.addInput(schemaInput);

        const result = await quicktype({ inputData, lang: "rust" });
        const output = result.lines.join("\n");

        expect(output).toContain("pub struct Item");
        expect(output).toContain("output: Option<String>");
        expect(output).toContain("summary: Option<String>");
    });
});
