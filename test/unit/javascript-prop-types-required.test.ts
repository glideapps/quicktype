import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";
import { describe, expect, test } from "vitest";

async function renderPropTypes(schema: object): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "Component",
        schema: JSON.stringify(schema),
    });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "javascript-prop-types",
    });
    return result.lines.join("\n");
}

function propertyLine(output: string, property: string): string | undefined {
    return output
        .split("\n")
        .find((line) => line.trimStart().startsWith(`"${property}":`));
}

describe("JavaScript PropTypes required properties", () => {
    test("marks only required shape validators as required", async () => {
        const output = await renderPropTypes({
            type: "object",
            required: ["anything", "disabled", "options", "tags"],
            properties: {
                anything: {},
                disabled: { type: "boolean" },
                options: {
                    type: "object",
                    properties: { label: { type: "string" } },
                },
                tags: { type: "array", items: { type: "string" } },
                type: {
                    type: "string",
                    enum: ["primary choice", "secondary"],
                },
            },
        });

        expect(propertyLine(output, "anything")).toContain(
            "PropTypes.any.isRequired",
        );
        expect(propertyLine(output, "disabled")).toContain(
            "PropTypes.bool.isRequired",
        );
        expect(propertyLine(output, "options")).toContain(
            "_Options.isRequired",
        );
        expect(propertyLine(output, "tags")).toContain(
            "PropTypes.arrayOf(PropTypes.string).isRequired",
        );
        expect(propertyLine(output, "type")).not.toContain(".isRequired");
        expect(output).toContain(
            'const _Type = PropTypes.oneOf(["primary choice", "secondary"]);',
        );
        expect(output).not.toContain("const _Type = PropTypes.oneOfType(");
    });
});
