import { describe, expect, test } from "vitest";

import {
    InputData,
    JSONSchemaInput,
    type RendererOptions,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";

async function renderCSharp(rendererOptions: RendererOptions): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "Request",
        schema: JSON.stringify({
            type: "object",
            properties: {
                profile: {
                    type: "object",
                    properties: { id: { type: "string" } },
                },
                displayName: { type: "string" },
            },
        }),
    });

    const inputData = new InputData();
    inputData.addInput(schemaInput);
    const result = await quicktype({
        inputData,
        lang: "csharp",
        rendererOptions,
    });
    return result.lines.join("\n");
}

describe("C# nullable reference types", () => {
    test("keeps the default Newtonsoft output unchanged", async () => {
        const output = await renderCSharp({
            framework: "NewtonSoft",
            "csharp-version": "6",
            "check-required": true,
        });

        expect(output).toContain(
            '[JsonProperty("profile", Required = Required.DisallowNull, NullValueHandling = NullValueHandling.Ignore)]',
        );
        expect(output).toContain("public Profile Profile { get; set; }");
        expect(output).toContain("public static Request FromJson(string json)");
        expect(output).not.toContain("#nullable enable");
    });

    test("opts into nullable optional properties for Newtonsoft", async () => {
        const output = await renderCSharp({
            framework: "NewtonSoft",
            "csharp-version": "6",
            "check-required": true,
            "nullable-reference-types": true,
        });

        expect(output).toContain("#nullable enable");
        expect(output).toContain(
            '[JsonProperty("profile", NullValueHandling = NullValueHandling.Ignore)]',
        );
        expect(output).not.toContain("Required.DisallowNull");
        expect(output).toContain("public Profile? Profile { get; set; }");
        expect(output).toContain("public string? DisplayName { get; set; }");
        expect(output).toContain(
            "public static Request? FromJson(string json)",
        );
    });
});
