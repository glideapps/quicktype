// Kotlin's language-wide stringTypeMapping maps JSON Schema "date",
// "time", and "date-time" formats to java.time types for all frameworks.
// kotlinx.serialization has no built-in serializers for java.time, so the
// kotlinx renderer must emit custom KSerializer objects and register them
// with a `@file:UseSerializers(...)` annotation — otherwise the generated
// code doesn't compile ("Serializer has not been found for type
// 'OffsetDateTime'"). There is no kotlinx fixture in CI, so this unit test
// covers it.

import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { describe, expect, test } from "vitest";

async function kotlinxOutput(
    properties: Record<string, unknown>,
): Promise<string> {
    const schema = JSON.stringify({
        $schema: "http://json-schema.org/draft-06/schema#",
        type: "object",
        properties,
        required: Object.keys(properties),
    });
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name: "TopLevel", schema });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "kotlin",
        rendererOptions: { framework: "kotlinx" },
    });
    return result.lines.join("\n");
}

describe("kotlinx date/time serializers", () => {
    test("emits KSerializers and @file:UseSerializers for date/time types", async () => {
        const output = await kotlinxOutput({
            date: { type: "string", format: "date" },
            time: { type: "string", format: "time" },
            dateTime: { type: "string", format: "date-time" },
        });

        expect(output).toContain(
            "@file:UseSerializers(OffsetDateTimeSerializer::class, LocalDateSerializer::class, OffsetTimeSerializer::class)",
        );
        for (const [serializer, javaType] of [
            ["OffsetDateTimeSerializer", "OffsetDateTime"],
            ["LocalDateSerializer", "LocalDate"],
            ["OffsetTimeSerializer", "OffsetTime"],
        ]) {
            expect(output).toContain(
                `object ${serializer} : KSerializer<${javaType}>`,
            );
            expect(output).toContain(`import java.time.${javaType}`);
        }

        // The file annotation must precede the package declaration.
        expect(output.indexOf("@file:UseSerializers")).toBeLessThan(
            output.indexOf("package "),
        );
    });

    test("emits only the serializers that are used", async () => {
        const output = await kotlinxOutput({
            date: { type: "string", format: "date" },
        });

        expect(output).toContain(
            "@file:UseSerializers(LocalDateSerializer::class)",
        );
        expect(output).toContain("object LocalDateSerializer");
        expect(output).not.toContain("OffsetDateTimeSerializer");
        expect(output).not.toContain("OffsetTimeSerializer");
    });

    test("emits no serializer machinery without date/time types", async () => {
        const output = await kotlinxOutput({
            name: { type: "string" },
        });

        expect(output).not.toContain("@file:UseSerializers");
        expect(output).not.toContain("KSerializer");
        expect(output).not.toContain("java.time");
    });
});
