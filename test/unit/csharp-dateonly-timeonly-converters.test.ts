import {
    InputData,
    JSONSchemaInput,
    type RendererOptions,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";
import { describe, expect, test } from "vitest";

async function renderCSharp(
    rendererOptions: RendererOptions = {},
): Promise<string> {
    const schema = {
        type: "object",
        properties: {
            name: { type: "string" },
            count: { type: "integer" },
        },
        required: ["name", "count"],
    };

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
        rendererOptions: { framework: "SystemTextJson", ...rendererOptions },
    });
    return result.lines.join("\n");
}

describe("C# System.Text.Json DateOnly/TimeOnly converters", () => {
    test("emits the converters by default", async () => {
        const output = await renderCSharp();

        expect(output).toContain("class DateOnlyConverter");
        expect(output).toContain("class TimeOnlyConverter");
        expect(output).toContain("new DateOnlyConverter(),");
        expect(output).toContain("new TimeOnlyConverter(),");
    });

    test("omits the converters with dateonly-timeonly-converters=false", async () => {
        const output = await renderCSharp({
            "dateonly-timeonly-converters": "false",
        });

        expect(output).not.toContain("DateOnlyConverter");
        expect(output).not.toContain("TimeOnlyConverter");
        // The DateTimeOffset converter is unaffected.
        expect(output).toContain("class IsoDateTimeOffsetConverter");
        expect(output).toContain("IsoDateTimeOffsetConverter.Singleton");
    });
});
