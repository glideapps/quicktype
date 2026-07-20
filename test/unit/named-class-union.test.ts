// Regression test for issue #1646: explicitly named object alternatives in a
// JSON Schema oneOf/anyOf must remain distinct when the target language supports
// unions with multiple object types.
//
// End-to-end round-trip coverage lives in
// `test/inputs/schema/named-class-union.schema`.  The fixture cannot assert
// that no synthetic merged class was generated, so that structural detail is
// covered here.

import {
    FetchingJSONSchemaStore,
    InputData,
    JSONSchemaInput,
    quicktype,
} from "quicktype-core";
import { describe, expect, test } from "vitest";

function schemaWithUnion(operation: "oneOf" | "anyOf"): object {
    const alternatives = [
        { $ref: "#/definitions/Foo" },
        { $ref: "#/definitions/Bar" },
    ];
    return {
        type: "object",
        additionalProperties: false,
        properties: {
            op:
                operation === "oneOf"
                    ? { oneOf: alternatives }
                    : { anyOf: alternatives },
        },
        required: ["op"],
        definitions: {
            Foo: {
                type: "object",
                additionalProperties: false,
                properties: { foo: { type: "string" } },
                required: ["foo"],
            },
            Bar: {
                type: "object",
                additionalProperties: false,
                properties: { bar: { type: "string" } },
                required: ["bar"],
            },
        },
    };
}

async function generate(
    lang: "python" | "typescript",
    operation: "oneOf" | "anyOf" = "oneOf",
): Promise<string> {
    const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());
    await schemaInput.addSource({
        name: "Container",
        schema: JSON.stringify(schemaWithUnion(operation)),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang,
        rendererOptions: lang === "python" ? { "python-version": "3.7" } : {},
    });
    return result.lines.join("\n");
}

describe("named class unions (issue #1646)", () => {
    test("Python preserves the named alternatives", async () => {
        const output = await generate("python");

        expect(output).toContain("class Foo:");
        expect(output).toContain("class Bar:");
        expect(output).toContain("op: Union[Foo, Bar]");
        expect(output).not.toContain("class Op:");
        expect(output).toContain("from_union([Foo.from_dict, Bar.from_dict]");
    });

    test("Python preserves anyOf alternatives produced by TypeScript input", async () => {
        const output = await generate("python", "anyOf");

        expect(output).toContain("op: Union[Foo, Bar]");
        expect(output).not.toContain("class Op:");
    });

    test("languages that do not opt in keep the existing behavior", async () => {
        const output = await generate("typescript");

        expect(output).toContain("op: Foo;");
        expect(output).toContain("export interface Foo {");
        expect(output).toContain("foo?: string;");
        expect(output).toContain("bar?: string;");
        expect(output).not.toContain("export interface Bar {");
    });
});
