import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { expect, test } from "vitest";

test("preserves JSON Schema enum case order (C#)", async () => {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "DaySchema",
        schema: JSON.stringify({
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "string",
            enum: ["Monday", "Tuesday", "Friday", "Sunday"],
        }),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "csharp" });

    expect(result.lines.join("\n")).toContain(
        "public enum DaySchemaEnum { Monday, Tuesday, Friday, Sunday };",
    );
});

test("preserves JSON Schema enum case order (C++)", async () => {
    const schema = JSON.stringify({
        $schema: "http://json-schema.org/draft-04/schema#",
        title: "Test",
        type: "object",
        properties: {
            errorCode: {
                type: "string",
                enum: ["B", "A", "E"],
            },
        },
    });

    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name: "Test", schema });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "c++" });

    expect(result.lines).toContain(
        "    enum class ErrorCode : int { B, A, E };",
    );
});
