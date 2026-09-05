import {
    InputData,
    JSONSchemaInput,
    type RendererOptions,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";
import { describe, expect, test } from "vitest";

async function renderSwift(
    schema: object,
    rendererOptions: RendererOptions = {},
): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "TopLevel",
        schema: JSON.stringify(schema),
    });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "swift",
        rendererOptions,
    });
    return result.lines.join("\n");
}

function classDeclarations(output: string): string[] {
    return output
        .split("\n")
        .filter((line) =>
            /^\s*(?:(?:public|internal)\s+)?(?:final\s+)?class\s+/.test(line),
        );
}

describe("Swift class generation", () => {
    const modelSchema = {
        type: "object",
        properties: {
            child: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
            },
        },
        required: ["child"],
    };
    const recursiveSchema = {
        $ref: "#/definitions/Node",
        definitions: {
            Node: {
                type: "object",
                properties: {
                    next: { $ref: "#/definitions/Node" },
                    value: {},
                },
                required: ["value"],
            },
        },
    };

    test("keeps classes open by default", async () => {
        const modelOutput = await renderSwift(modelSchema, {
            "struct-or-class": "class",
        });
        const recursiveOutput = await renderSwift(recursiveSchema);
        const declarations = classDeclarations(
            `${modelOutput}\n${recursiveOutput}`,
        );

        expect(declarations.length).toBeGreaterThan(0);
        expect(
            declarations.every((line) => !line.includes("final class")),
        ).toBe(true);
    });

    test("marks requested model classes as final when enabled", async () => {
        const output = await renderSwift(modelSchema, {
            "struct-or-class": "class",
            "final-classes": "true",
        });
        const declarations = classDeclarations(output);

        expect(declarations).toHaveLength(2);
        expect(declarations).toEqual(
            expect.arrayContaining([
                expect.stringContaining("final class TopLevel"),
                expect.stringContaining("final class Child"),
            ]),
        );
    });

    test("marks cycle breakers and Codable helper classes as final", async () => {
        const output = await renderSwift(recursiveSchema, {
            "final-classes": "true",
        });
        const declarations = classDeclarations(output);

        expect(declarations).toEqual(
            expect.arrayContaining([
                expect.stringContaining("final class TopLevel"),
                expect.stringContaining("final class JSONNull"),
                expect.stringContaining("final class JSONCodingKey"),
                expect.stringContaining("final class JSONAny"),
            ]),
        );
        expect(declarations.every((line) => line.includes("final class"))).toBe(
            true,
        );
    });

    test("can nest child types to avoid multi-source name collisions", async () => {
        const first = new JSONSchemaInput(undefined);
        await first.addSource({
            name: "First",
            schema: JSON.stringify(modelSchema),
        });
        const second = new JSONSchemaInput(undefined);
        await second.addSource({
            name: "Second",
            schema: JSON.stringify(modelSchema),
        });
        const inputData = new InputData();
        inputData.addInput(first);
        inputData.addInput(second);

        const result = await quicktype({
            inputData,
            lang: "swift",
            rendererOptions: { "nest-types": true },
        });
        const output = result.lines.join("\n");

        expect(output).toContain("struct First");
        expect(output).toContain("struct Second");
        expect(output).toContain("struct FirstChild");
        expect(output).toContain("struct SecondChild");
        expect(output).toContain("First.FirstChild");
        expect(output).toContain("Second.SecondChild");
        expect(output).not.toMatch(/^struct (?:FirstChild|SecondChild)/m);
    });

    test("scopes JSON helpers as static members when nesting", async () => {
        const output = await renderSwift(modelSchema, {
            "nest-types": "true",
        });

        // Helpers become static members of the top-level type ...
        expect(output).toMatch(
            /^ {4}static func newJSONDecoder\(\) -> JSONDecoder/m,
        );
        expect(output).toMatch(
            /^ {4}static func newJSONEncoder\(\) -> JSONEncoder/m,
        );
        // ... and no module-level helper free functions are emitted.
        expect(output).not.toMatch(/^func newJSONDecoder\(\)/m);
        expect(output).not.toMatch(/^func newJSONEncoder\(\)/m);
        // Convenience initializers qualify their helper calls with the owner.
        expect(output).toContain("TopLevel.newJSONDecoder()");
        expect(output).toContain("TopLevel.newJSONEncoder()");
    });

    test("keeps module-level helpers when nesting is disabled", async () => {
        const output = await renderSwift(modelSchema);

        expect(output).toMatch(/^func newJSONDecoder\(\) -> JSONDecoder/m);
        expect(output).toMatch(/^func newJSONEncoder\(\) -> JSONEncoder/m);
        expect(output).not.toMatch(/static func newJSONDecoder/);
    });

    test("renames a child type named CodingKeys instead of shadowing the owner's synthesized enum", async () => {
        const schema = {
            type: "object",
            properties: {
                "coding-keys": {
                    type: "object",
                    properties: { foo: { type: "string" } },
                    required: ["foo"],
                },
            },
            required: ["coding-keys"],
        };

        const output = await renderSwift(schema, { "nest-types": "true" });

        // The owner emits a synthetic `enum CodingKeys`, so a child that
        // would otherwise be named `CodingKeys` is renamed (e.g. to
        // `CodingKeysClass`) and nested. Keeping the name `CodingKeys`
        // would either redeclare the owner's enum (when nested) or shadow
        // it during unqualified lookup (when left at module scope), both
        // of which break `Codable` synthesis.
        expect(output).not.toMatch(/\bstruct CodingKeys\b/);
        expect(output).toMatch(/^ {4}struct CodingKeysClass: Codable/m);
        expect(output).toMatch(/let codingKeys: \w*\.CodingKeysClass/);
    });
});
