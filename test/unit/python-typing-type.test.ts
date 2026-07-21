// Python fixtures exercise every version preset, but cannot verify that the
// generated imports also work on the first Python 3.6 micro-version.
import { describe, expect, test } from "vitest";

import {
    InputData,
    JSONSchemaInput,
    jsonInputForTargetLanguage,
    quicktype,
} from "quicktype-core";

const schema = {
    type: "object",
    properties: {
        child: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
        },
        status: { type: "string", enum: ["ready", "done"] },
        value: { oneOf: [{ type: "integer" }, { type: "string" }] },
    },
    required: ["child", "status", "value"],
};

async function pythonFor(version: "3.6" | "3.7"): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "TopLevel",
        schema: JSON.stringify(schema),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);
    const schemaResult = await quicktype({
        inputData,
        lang: "python",
        rendererOptions: { "python-version": version },
    });

    // An inferred integer-string union exercises the is_type helper.
    const jsonInput = jsonInputForTargetLanguage("python");
    await jsonInput.addSource({
        name: "MixedValues",
        samples: ['{"mixed":[null,1,"1",{}]}'],
    });
    const jsonInputData = new InputData();
    jsonInputData.addInput(jsonInput);
    const jsonResult = await quicktype({
        inputData: jsonInputData,
        lang: "python",
        rendererOptions: { "python-version": version },
    });

    return [...schemaResult.lines, ...jsonResult.lines].join("\n");
}

describe("Python typing.Type compatibility (issue #1728)", () => {
    test("Python 3.6 does not import or use typing.Type", async () => {
        const output = await pythonFor("3.6");

        expect(output).toContain('T = TypeVar("T")');
        expect(output).not.toMatch(/from typing import [^\n]*\bType\b/);
        expect(output).not.toMatch(/\bType\[/);
        expect(output).toContain("def to_class(c, x: Any) -> dict:");
        expect(output).toContain("def to_enum(c, x: Any) -> EnumT:");
        expect(output).toContain("def is_type(t, x: Any) -> T:");
    });

    test("Python 3.7 keeps typing.Type annotations", async () => {
        const output = await pythonFor("3.7");

        expect(output).toMatch(/from typing import [^\n]*\bType\b/);
        expect(output).toContain("def to_class(c: Type[T], x: Any) -> dict:");
        expect(output).toContain(
            "def to_enum(c: Type[EnumT], x: Any) -> EnumT:",
        );
        expect(output).toContain("def is_type(t: Type[T], x: Any) -> T:");
    });
});
