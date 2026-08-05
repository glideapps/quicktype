import fs from "node:fs";

import { describe, expect, test } from "vitest";

import {
    InputData,
    JSONSchemaInput,
    jsonInputForTargetLanguage,
    quicktype,
} from "quicktype-core";

async function typesForSchema(filename: string, name: string): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name,
        schema: fs.readFileSync(`test/inputs/schema/${filename}`, "utf8"),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);
    const result = await quicktype({
        inputData,
        lang: "typescript",
        rendererOptions: { "just-types": true },
    });
    return result.lines.join("\n");
}

async function typesForJSON(name: string, sample: string): Promise<string> {
    const jsonInput = jsonInputForTargetLanguage("typescript");
    await jsonInput.addSource({ name, samples: [sample] });
    const inputData = new InputData();
    inputData.addInput(jsonInput);
    const result = await quicktype({
        inputData,
        lang: "typescript",
        rendererOptions: { "just-types": true },
    });
    return result.lines.join("\n");
}

async function typesForJSONViaSchema(
    name: string,
    sample: string,
): Promise<string> {
    const jsonInput = jsonInputForTargetLanguage("schema");
    await jsonInput.addSource({ name, samples: [sample] });
    const inputData = new InputData();
    inputData.addInput(jsonInput);
    const schema = await quicktype({ inputData, lang: "schema" });

    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name, schema: schema.lines.join("\n") });
    const schemaInputData = new InputData();
    schemaInputData.addInput(schemaInput);
    const result = await quicktype({
        inputData: schemaInputData,
        lang: "typescript",
        rendererOptions: { "just-types": true },
    });
    return result.lines.join("\n");
}

describe("TypeScript top-level arrays", () => {
    test("schema array emits an alias and preserves the item title", async () => {
        const output = await typesForSchema(
            "top-level-array.schema",
            "TextClassificationOutput",
        );

        expect(output).toContain(
            "export type TextClassificationOutput = TextClassificationOutputElement[];",
        );
        expect(output).toContain(
            "export interface TextClassificationOutputElement",
        );
    });

    test("schema array of primitives emits an alias", async () => {
        const output = await typesForSchema(
            "top-level-primitive-array.schema",
            "SomeInput",
        );

        expect(output).toContain("export type SomeInput = string[];");
    });

    test("JSON sample arrays emit an alias", async () => {
        const sample = '[{"label":"a","score":1},{"label":"b","score":2}]';
        const output = await typesForJSON("Sample", sample);

        expect(output).toContain("export type Sample = SampleElement[];");
        expect(output).toContain("export interface SampleElement");
        expect(await typesForJSONViaSchema("Sample", sample)).toBe(output);
    });

    test("JSON primitive arrays emit an alias", async () => {
        const sample = '["one","two"]';
        const output = await typesForJSON("Sample", sample);

        expect(output).toContain("export type Sample = string[];");
        expect(await typesForJSONViaSchema("Sample", sample)).toBe(output);
    });
});
