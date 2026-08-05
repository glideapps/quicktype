import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { describe, expect, test } from "vitest";

async function renderGo(
    name: string,
    schema: object,
    enumTypeNameSuffix: boolean | undefined,
): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name, schema: JSON.stringify(schema) });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "go",
        rendererOptions:
            enumTypeNameSuffix === undefined
                ? {}
                : { "enum-type-name-suffix": enumTypeNameSuffix },
    });
    return result.lines.join("\n");
}

const dogNoiseSchema = {
    type: "string",
    enum: ["BARK", "GROWL", "HOWL"],
};

describe("Go enum type name suffix", () => {
    test("is off by default and qualifies constants when enabled", async () => {
        const defaultOutput = await renderGo(
            "DogNoise",
            dogNoiseSchema,
            undefined,
        );
        const qualifiedOutput = await renderGo(
            "DogNoise",
            dogNoiseSchema,
            true,
        );
        const independentlyQualifiedOutput = await renderGo(
            "TreePart",
            {
                type: "string",
                enum: ["BARK", "LEAF", "ROOT"],
            },
            true,
        );

        expect(defaultOutput).toMatch(/Bark\s+DogNoise = "BARK"/);
        expect(qualifiedOutput).toMatch(/BarkDogNoise\s+DogNoise = "BARK"/);
        expect(qualifiedOutput).toMatch(/GrowlDogNoise\s+DogNoise = "GROWL"/);
        expect(qualifiedOutput).toMatch(/HowlDogNoise\s+DogNoise = "HOWL"/);
        expect(independentlyQualifiedOutput).toMatch(
            /BarkTreePart\s+TreePart = "BARK"/,
        );
    });

    test("resolves collisions using the complete qualified name", async () => {
        const output = await renderGo(
            "TopLevel",
            {
                type: "object",
                properties: {
                    noise: { $ref: "#/$defs/DogNoise" },
                    collision: { $ref: "#/$defs/BarkDogNoise" },
                },
                $defs: {
                    DogNoise: dogNoiseSchema,
                    BarkDogNoise: {
                        type: "object",
                        properties: { value: { type: "string" } },
                    },
                },
            },
            true,
        );

        expect(output).toContain("type BarkDogNoise struct");
        expect(output).not.toMatch(/^\s*BarkDogNoise\s+DogNoise = "BARK"/m);
        expect(output).toMatch(/^\s*\w*BarkDogNoise\s+DogNoise = "BARK"/m);
    });
});
