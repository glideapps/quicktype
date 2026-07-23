// Every quicktype language spells "generate plain types without
// (de)serialization helpers" as the boolean `just-types` option.  C#'s
// `features=just-types` / `features=just-types-and-namespace` and Kotlin's,
// Scala 3's, and Smithy4s's `framework=just-types` are gone; the boolean
// wins over a conflicting explicit enum value.
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, test } from "vitest";

import {
    InputData,
    JSONSchemaInput,
    type LanguageName,
    type RendererOptions,
    jsonInputForTargetLanguage,
    quicktype,
} from "quicktype-core";
import { schemaForTypeScriptSources } from "quicktype-typescript-input";

async function linesFor(
    lang: LanguageName,
    rendererOptions: RendererOptions = {},
): Promise<string> {
    const jsonInput = jsonInputForTargetLanguage(lang);
    await jsonInput.addSource({
        name: "Person",
        samples: ['{"name": "Alice", "age": 37}'],
    });
    const inputData = new InputData();
    inputData.addInput(jsonInput);
    const result = await quicktype({ inputData, lang, rendererOptions });
    return result.lines.join("\n");
}

async function kotlinLinesForTypeScript(source: string): Promise<string> {
    const temporaryDirectory = fs.mkdtempSync(
        path.join(process.cwd(), ".tmp-kotlin-just-types-test-"),
    );
    const fileName = path.join(temporaryDirectory, "input.ts");

    try {
        fs.writeFileSync(fileName, source);
        const schemaInput = new JSONSchemaInput(undefined);
        await schemaInput.addSource(schemaForTypeScriptSources([fileName]));
        const inputData = new InputData();
        inputData.addInput(schemaInput);
        const result = await quicktype({
            inputData,
            lang: "kotlin",
            rendererOptions: { "just-types": true },
        });
        return result.lines.join("\n");
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
}

describe("just-types generates plain types in every language", () => {
    test("C#: no attributes, no helpers, but a namespace", async () => {
        const output = await linesFor("csharp", { "just-types": true });
        expect(output).toContain("namespace QuickType");
        expect(output).toContain("public partial class Person");
        expect(output).not.toContain("JsonConverter");
        expect(output).not.toContain("JsonProperty");
    });

    test("C#: just-types with use-records emits records without helpers", async () => {
        const output = await linesFor("csharp", {
            "just-types": true,
            "use-records": true,
        });
        expect(output).toContain("namespace QuickType");
        expect(output).toContain("public partial record Person");
        expect(output).not.toContain("JsonConverter");
        expect(output).not.toContain("FromJson");
    });

    test("Kotlin: plain data classes, no Klaxon", async () => {
        const output = await linesFor("kotlin", { "just-types": true });
        expect(output).toContain("data class Person");
        expect(output).not.toContain("Klaxon");
    });

    test("Kotlin: enum cases retain their TypeScript string values", async () => {
        const output = await kotlinLinesForTypeScript(`
            export enum CanvasAction {
                ADD = "add",
                BRING_TO_FRONT = "bringtofront",
                DELETE = "delete",
                FLIP = "flip",
                INVERT = "invert",
                UNDO = "undo",
                REDO = "redo",
            }

            export interface Canvas {
                action: CanvasAction;
            }
        `);

        expect(output).toContain("enum class CanvasAction(val value: String)");
        expect(output).toContain('Add("add")');
        expect(output).toContain('BringToFront("bringtofront")');
        expect(output).toContain(
            "fun fromValue(value: String): CanvasAction = when (value)",
        );
    });

    test("Scala 3: plain case classes, no circe", async () => {
        const output = await linesFor("scala3", { "just-types": true });
        expect(output).toContain("case class Person");
        expect(output).not.toContain("circe");
    });

    test("Smithy: accepted (plain types is the only mode)", async () => {
        const viaBoolean = await linesFor("smithy4a", { "just-types": true });
        expect(viaBoolean).toContain("structure Person");
        expect(viaBoolean).toEqual(await linesFor("smithy4a"));
    });
});

describe("C# generated-file marker", () => {
    test.each([
        ["SystemTextJson attributes-only", { features: "attributes-only" }],
        [
            "NewtonSoft attributes-only",
            { framework: "NewtonSoft", features: "attributes-only" },
        ],
        ["just-types", { "just-types": true }],
        ["complete", { features: "complete" }],
    ] as Array<
        [string, RendererOptions]
    >)("%s", async (_name, rendererOptions) => {
        const output = await linesFor("csharp", rendererOptions);
        expect(output.startsWith("// <auto-generated />\n//\n")).toBe(true);
    });
});

describe("the removed enum spellings are errors", () => {
    // The old spellings aren't valid `RendererOptions` anymore, which is
    // the point: they must also fail for API callers who evade the types.
    test("C#: features=just-types", async () => {
        const options = { features: "just-types" } as RendererOptions;
        await expect(linesFor("csharp", options)).rejects.toThrow(
            "Unknown value just-types for option features",
        );
    });

    test("C#: features=just-types-and-namespace", async () => {
        const options = {
            features: "just-types-and-namespace",
        } as RendererOptions;
        await expect(linesFor("csharp", options)).rejects.toThrow(
            "Unknown value just-types-and-namespace for option features",
        );
    });

    test("Kotlin: framework=just-types", async () => {
        const options = { framework: "just-types" } as RendererOptions;
        await expect(linesFor("kotlin", options)).rejects.toThrow(
            "Unknown value just-types for option framework",
        );
    });

    test("Scala 3: framework=just-types", async () => {
        const options = { framework: "just-types" } as RendererOptions;
        await expect(linesFor("scala3", options)).rejects.toThrow(
            "Unknown value just-types for option framework",
        );
    });
});

describe("just-types wins over a conflicting enum option", () => {
    test("C#: just-types beats features=attributes-only", async () => {
        const output = await linesFor("csharp", {
            "just-types": true,
            features: "attributes-only",
        });
        expect(output).toEqual(
            await linesFor("csharp", { "just-types": true }),
        );
        expect(output).not.toContain("JsonProperty");
    });

    test("Kotlin: just-types beats framework=jackson", async () => {
        const output = await linesFor("kotlin", {
            "just-types": true,
            framework: "jackson",
        });
        expect(output).toEqual(
            await linesFor("kotlin", { "just-types": true }),
        );
        expect(output).not.toContain("jackson");
    });

    test("Scala 3: just-types beats framework=upickle", async () => {
        const output = await linesFor("scala3", {
            "just-types": true,
            framework: "upickle",
        });
        expect(output).toEqual(
            await linesFor("scala3", { "just-types": true }),
        );
        expect(output).not.toContain("upickle");
    });
});

describe("framework defaults", () => {
    test("Scala 3 defaults to circe", async () => {
        const output = await linesFor("scala3");
        expect(output).toContain("io.circe");
    });

    test("Kotlin defaults to Jackson", async () => {
        const output = await linesFor("kotlin");
        expect(output).toContain("com.fasterxml.jackson");
    });
});
