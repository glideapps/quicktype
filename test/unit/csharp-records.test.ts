import { describe, expect, test } from "vitest";

import {
    InputData,
    type RendererOptions,
    jsonInputForTargetLanguage,
    quicktype,
} from "quicktype-core";

async function renderCSharp(
    rendererOptions: RendererOptions,
    sample = '{"name":"Alice","age":37}',
): Promise<string> {
    const jsonInput = jsonInputForTargetLanguage("csharp");
    await jsonInput.addSource({
        name: "Person",
        samples: [sample],
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

describe("C# use-records", () => {
    test.each([
        "NewtonSoft",
        "SystemTextJson",
    ] as const)("%s emits partial record when use-records is on", async (framework) => {
        const output = await renderCSharp({
            framework,
            "use-records": true,
        });
        expect(output).toContain("public partial record Person");
        expect(output).not.toMatch(/public partial class Person\b/);
        // Helpers stay classes; only data types become records.
        expect(output).toContain("public static partial class Serialize");
        expect(output).toContain("internal static partial class Converter");
    });

    test("default remains partial class", async () => {
        const output = await renderCSharp({ framework: "SystemTextJson" });
        expect(output).toContain("public partial class Person");
        expect(output).not.toContain("public partial record Person");
    });

    test("avoids compiler-generated record member names", async () => {
        const output = await renderCSharp(
            { "use-records": true },
            '{"clone":"copy","equalityContract":"contract","printMembers":"members"}',
        );
        expect(output).not.toMatch(
            /public string (Clone|EqualityContract|PrintMembers) \{/,
        );
    });

    test("just-types with use-records still emits records", async () => {
        const output = await renderCSharp({
            "use-records": true,
            "just-types": true,
        });
        expect(output).toContain("public partial record Person");
        expect(output).not.toContain("JsonConverter");
        expect(output).not.toContain("FromJson");
    });
});
