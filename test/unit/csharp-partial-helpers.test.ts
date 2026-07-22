import { describe, expect, test } from "vitest";

import {
    InputData,
    type RendererOptions,
    jsonInputForTargetLanguage,
    quicktype,
} from "quicktype-core";

async function cSharpFor(framework: string): Promise<string> {
    const jsonInput = jsonInputForTargetLanguage("csharp");
    await jsonInput.addSource({
        name: "Something",
        samples: ['{"some_property":"hello"}'],
    });
    const inputData = new InputData();
    inputData.addInput(jsonInput);
    const rendererOptions = { framework } as RendererOptions;
    const result = await quicktype({
        inputData,
        lang: "csharp",
        rendererOptions,
    });
    return result.lines.join("\n");
}

describe("C# helper classes", () => {
    for (const framework of ["NewtonSoft", "SystemTextJson"]) {
        test(`${framework} helpers are partial`, async () => {
            const output = await cSharpFor(framework);
            expect(output).toContain("public static partial class Serialize");
            expect(output).toContain("internal static partial class Converter");
        });
    }
});
