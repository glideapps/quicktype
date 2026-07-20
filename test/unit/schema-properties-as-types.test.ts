import {
    FetchingJSONSchemaStore,
    InputData,
    JSONSchemaInput,
    quicktype,
} from "quicktype-core";
import { describe, expect, test } from "vitest";

async function generateTypeScript(name: string, uri: string): Promise<string> {
    const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());
    await schemaInput.addSource({ name, uris: [uri] });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "typescript" });
    return result.lines.join("\n");
}

describe("schema URI properties-as-types mode", () => {
    test("a trailing slash at the document root keeps the document as one type", async () => {
        const output = await generateTypeScript(
            "Test",
            "test/inputs/schema/a/test2.json#/",
        );

        expect(output).toContain("export interface Test");
        expect(output).toMatch(/foo:\s+number/);
    });

    test("a trailing slash below the root makes properties separate types", async () => {
        const output = await generateTypeScript(
            "Definitions",
            "test/inputs/schema/b/test3.json#/definitions/",
        );

        expect(output).toContain("export interface Foo");
        expect(output).toMatch(/foo:\s+number/);
    });
});
