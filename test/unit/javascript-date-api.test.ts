import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { expect, test } from "vitest";

interface GeneratedConverters {
    topLevelToJson: (value: { when: Date }) => string;
}

async function converters(): Promise<GeneratedConverters> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "TopLevel",
        schema: JSON.stringify({
            type: "object",
            properties: {
                when: { type: "string", format: "date-time" },
            },
            required: ["when"],
        }),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);
    const result = await quicktype({ inputData, lang: "javascript" });
    const generatedModule: { exports: Partial<GeneratedConverters> } = {
        exports: {},
    };
    new Function("exports", "module", result.lines.join("\n"))(
        generatedModule.exports,
        generatedModule,
    );
    return generatedModule.exports as GeneratedConverters;
}

test("JavaScript converter validates Date instances", async () => {
    const { topLevelToJson } = await converters();

    expect(
        JSON.parse(topLevelToJson({ when: new Date("2024-02-29T00:00:00Z") })),
    ).toEqual({ when: "2024-02-29T00:00:00.000Z" });
    expect(() => topLevelToJson({ when: new Date(Number.NaN) })).toThrow(
        "Expected Date",
    );
});
