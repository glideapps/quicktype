// Regression test for #1959: `propertyNames` was ignored, so maps came out
// unconstrained. The fixture test `property-names.schema` covers the runtime
// converter; this covers the emitted type shape, which fixtures can't check.

import {
    FetchingJSONSchemaStore,
    InputData,
    JSONSchemaInput,
    quicktype,
} from "quicktype-core";
import { describe, expect, test } from "vitest";

const language = {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
};

async function generate(schema: object, lang = "typescript"): Promise<string> {
    const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());
    await schemaInput.addSource({
        name: "Foo",
        schema: JSON.stringify(schema),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang,
        rendererOptions: { "just-types": "true" },
    });
    return result.lines.join("\n");
}

async function generateTypeScript(schema: object): Promise<string> {
    return await generate(schema);
}

function schemaWithPropertyNames(
    propertyNames: object,
    languagesExtra: object = {},
): object {
    return {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        required: ["languages"],
        properties: {
            languages: {
                type: "object",
                propertyNames,
                additionalProperties: language,
                ...languagesExtra,
            },
        },
    };
}

describe("JSON Schema propertyNames (issue #1959)", () => {
    test("an enum of key names constrains the map's keys", async () => {
        const output = await generateTypeScript(
            schemaWithPropertyNames({ type: "string", enum: ["de", "en"] }),
        );

        expect(output).toContain(
            'languages: Partial<Record<"de" | "en", Language>>;',
        );
    });

    test("the keys stay optional", async () => {
        const output = await generateTypeScript(
            schemaWithPropertyNames({ type: "string", enum: ["de", "en"] }),
        );

        // `{}` is still valid; a bare `Record<...>` would require every key.
        expect(output).toContain("Partial<Record<");
        expect(output).not.toMatch(/languages: Record</);
    });

    test("a string const is a single allowed key", async () => {
        const output = await generateTypeScript(
            schemaWithPropertyNames({ type: "string", const: "en" }),
        );

        expect(output).toContain('languages: Partial<Record<"en", Language>>;');
    });

    test("required keys become properties rather than a map", async () => {
        const output = await generateTypeScript(
            schemaWithPropertyNames(
                { type: "string", enum: ["de", "en"] },
                { required: ["en"] },
            ),
        );

        expect(output).toContain("de?: Language;");
        expect(output).toContain("en:  Language;");
        expect(output).not.toContain("[property: string]: Language;");
    });

    test("required keys with no permitted values is still an error", async () => {
        // `additionalProperties: false` permits no keys, so requiring one
        // contradicts the schema.
        await expect(
            generateTypeScript(
                schemaWithPropertyNames(
                    { type: "string", enum: ["de", "en"] },
                    { required: ["en"], additionalProperties: false },
                ),
            ),
        ).rejects.toThrow(/required properties but forbidden additionalTypes/);
    });

    test("a non-finite constraint leaves the keys alone", async () => {
        const output = await generateTypeScript(
            schemaWithPropertyNames({ type: "string", pattern: "^[a-z]{2}$" }),
        );

        expect(output).toContain("languages: { [key: string]: Language };");
    });

    test("a mixed-type enum leaves the keys alone", async () => {
        const output = await generateTypeScript(
            schemaWithPropertyNames({ enum: ["de", 3] }),
        );

        expect(output).toContain("languages: { [key: string]: Language };");
    });

    test("a $ref'd constraint leaves the keys alone", async () => {
        const output = await generateTypeScript({
            ...schemaWithPropertyNames({ $ref: "#/definitions/Lang" }),
            definitions: { Lang: { type: "string", enum: ["de", "en"] } },
        });

        // Known limitation: cases are read straight off the schema, and a
        // $ref doesn't carry them.
        expect(output).toContain("languages: { [key: string]: Language };");
    });

    test("keys are escaped", async () => {
        const output = await generateTypeScript(
            schemaWithPropertyNames({ enum: ['a"b', "c-d"] }),
        );

        expect(output).toContain('Partial<Record<"a\\"b" | "c-d", Language>>');
    });
});

// Only TypeScript spells the constraint out; other renderers must be
// unaffected since the attribute rides on a shared type graph.
describe("propertyNames leaves other languages alone", () => {
    const schema = schemaWithPropertyNames({
        type: "string",
        enum: ["de", "en"],
    });

    test("Flow keeps its index signature", async () => {
        // Shares a base renderer with TypeScript, so easy to break by accident.
        const output = await generate(schema, "flow");

        expect(output).toContain("languages: { [key: string]: Language };");
        expect(output).not.toContain("Partial<Record<");
    });

    test("Python keeps its plain dict", async () => {
        const output = await generate(schema, "python");

        expect(output).toContain("languages: dict[str, Language]");
        expect(output).not.toContain("Literal");
    });

    test("Go keeps its plain map", async () => {
        const output = await generate(schema, "go");

        expect(output).toContain("map[string]Language");
    });
});
