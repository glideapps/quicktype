import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";
import { describe, expect, test } from "vitest";

const schema = {
    $defs: {
        name: {
            type: "string",
            description: "name description",
        },
        surname: {
            type: "string",
            description: "surname description",
        },
    },
    type: "object",
    properties: {
        name: { $ref: "#/$defs/name" },
        surname: { $ref: "#/$defs/surname" },
    },
};

interface RenderedSchema {
    definitions: Record<
        string,
        { properties: Record<string, { description?: string }> }
    >;
}

async function generateSchema(): Promise<RenderedSchema> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "Input",
        schema: JSON.stringify(schema),
    });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "schema" });
    return JSON.parse(result.lines.join("\n")) as RenderedSchema;
}

describe("JSON Schema descriptions through $ref (issue #1582)", () => {
    test("descriptions from distinct definitions do not merge", async () => {
        const output = await generateSchema();
        const properties = output.definitions.Input.properties;

        expect(properties.name.description).toBe("name description");
        expect(properties.surname.description).toBe("surname description");
    });
});
