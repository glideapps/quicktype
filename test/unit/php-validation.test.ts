import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";
import { describe, expect, test } from "vitest";

async function phpForSchema(schema: object): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "ScalarValidation",
        schema: JSON.stringify(schema),
    });

    const inputData = new InputData();
    inputData.addInput(schemaInput);
    const result = await quicktype({ inputData, lang: "php" });
    return result.lines.join("\n");
}

function validationMethod(php: string, propertyName: string): string {
    const start = php.indexOf(
        `public static function validate${propertyName}(`,
    );
    if (start < 0) {
        throw new Error(
            `No validate${propertyName} method found in generated PHP`,
        );
    }
    const end = php.indexOf("\n    /**", start);
    return php.slice(start, end < 0 ? undefined : end);
}

describe("PHP property validation", () => {
    test("does not recheck scalar parameter types", async () => {
        const php = await phpForSchema({
            type: "object",
            properties: {
                boolean: { type: "boolean" },
                integer: { type: "integer" },
                number: { type: "number" },
                nullableNumber: { type: ["number", "null"] },
                string: { type: "string" },
                integers: { type: "array", items: { type: "integer" } },
                scalarUnion: {
                    oneOf: [{ type: "integer" }, { type: "string" }],
                },
            },
            required: [
                "boolean",
                "integer",
                "number",
                "nullableNumber",
                "string",
                "integers",
                "scalarUnion",
            ],
        });

        for (const property of [
            "Boolean",
            "Integer",
            "Number",
            "NullableNumber",
            "String",
        ]) {
            expect(validationMethod(php, property)).not.toMatch(
                /is_(?:bool|float|int|integer|string)\(/,
            );
        }

        expect(validationMethod(php, "Integers")).toContain(
            "if (!is_integer($value_v))",
        );
        expect(validationMethod(php, "ScalarUnion")).toContain(
            "if (is_int($value))",
        );
        expect(validationMethod(php, "ScalarUnion")).toContain(
            "elseif (is_string($value))",
        );
    });
});
