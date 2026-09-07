import { describe, expect, test } from "vitest";

import {
    InputData,
    JSONSchemaInput,
    quicktype,
    quicktypeMultiFile,
} from "../../packages/quicktype-core/src/index.js";

async function inputData(): Promise<InputData> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "TopLevel",
        schema: JSON.stringify({
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
        }),
    });

    const result = new InputData();
    result.addInput(schemaInput);
    return result;
}

describe("Swift JSON helper visibility", () => {
    test("keeps helpers file-private in standalone output", async () => {
        const result = await quicktype({
            inputData: await inputData(),
            lang: "swift",
        });
        const output = result.lines.join("\n");

        expect(output).toContain("fileprivate func newJSONDecoder()");
        expect(output).toContain("fileprivate func newJSONEncoder()");
    });

    test("keeps helpers visible to multi-file model output", async () => {
        const result = await quicktypeMultiFile({
            inputData: await inputData(),
            lang: "swift",
            rendererOptions: { "multi-file-output": true },
        });
        const support = Array.from(result).find(
            ([filename]) => filename === "JSONSchemaSupport.swift",
        );

        expect(support).toBeDefined();
        expect(support?.[1].lines.join("\n")).toContain(
            "func newJSONDecoder()",
        );
        expect(support?.[1].lines.join("\n")).not.toContain(
            "fileprivate func newJSONDecoder()",
        );
    });

    test("uses JSONDecoder when multi-file output has no helpers", async () => {
        const result = await quicktypeMultiFile({
            inputData: await inputData(),
            lang: "swift",
            rendererOptions: {
                "multi-file-output": true,
                initializers: false,
            },
        });
        const model = Array.from(result).find(
            ([filename]) => filename === "TopLevel.swift",
        );
        const support = Array.from(result).find(
            ([filename]) => filename === "JSONSchemaSupport.swift",
        );

        expect(model?.[1].lines.join("\n")).toContain(
            "try? JSONDecoder().decode(TopLevel.self, from: jsonData)",
        );
        expect(model?.[1].lines.join("\n")).not.toContain(
            "newJSONDecoder().decode",
        );
        expect(support?.[1].lines.join("\n")).not.toContain(
            "func newJSONDecoder()",
        );
    });
});
