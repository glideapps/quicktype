import { describe, expect, test } from "vitest";

import {
    InputData,
    type RendererOptions,
    jsonInputForTargetLanguage,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";

async function renderCSharp(rendererOptions: RendererOptions): Promise<string> {
    const jsonInput = jsonInputForTargetLanguage("csharp");
    await jsonInput.addSource({
        name: "Sample",
        samples: ['{"name":"Alice","age":30,"active":true}'],
    });

    const inputData = new InputData();
    inputData.addInput(jsonInput);
    const result = await quicktype({
        inputData,
        lang: "csharp",
        rendererOptions,
    });
    return result.lines.join("\n");
}

describe("C# using statements", () => {
    test("NewtonSoft attributes-only omits converter usings when no converter is emitted", async () => {
        const output = await renderCSharp({
            framework: "NewtonSoft",
            features: "attributes-only",
        });

        expect(output).toContain("using Newtonsoft.Json;");
        expect(output).not.toContain("using System.Globalization;");
        expect(output).not.toContain("using Newtonsoft.Json.Converters;");
    });

    test("SystemTextJson attributes-only omits globalization when no converter is emitted", async () => {
        const output = await renderCSharp({
            framework: "SystemTextJson",
            features: "attributes-only",
        });

        expect(output).toContain("using System.Text.Json.Serialization;");
        expect(output).not.toContain("using System.Globalization;");
    });

    test.each([
        ["NewtonSoft", "using Newtonsoft.Json.Converters;"],
        ["SystemTextJson", "using System.Globalization;"],
    ] as Array<
        ["NewtonSoft" | "SystemTextJson", string]
    >)("%s complete output keeps converter usings", async (framework, expectedUsing) => {
        const output = await renderCSharp({ framework });

        expect(output).toContain("using System.Globalization;");
        expect(output).toContain(expectedUsing);
        expect(output).toContain("IsoDateTime");
    });
});
