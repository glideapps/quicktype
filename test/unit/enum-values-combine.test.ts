import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { describe, expect, test } from "vitest";

// Two definitions of the same enum are one type, so their `qt-enum-values`
// are combined.
async function cJSONOutput(fValues: Record<string, string>): Promise<string> {
    const schema = JSON.stringify({
        definitions: {
            E: {
                type: "string",
                enum: ["a", "b"],
                "qt-enum-values": { a: "0", b: "1" },
            },
            F: {
                type: "string",
                enum: ["a", "b"],
                "qt-enum-values": fValues,
            },
        },
    });
    const schemaInput = new JSONSchemaInput(undefined);
    for (const name of ["E", "F"]) {
        await schemaInput.addSource({
            name,
            schema,
            uris: [`#/definitions/${name}`],
        });
    }
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "cjson" });
    return result.lines.join("\n");
}

describe("enum values of the same enum", () => {
    test("combine when every copy is the same", async () => {
        const output = await cJSONOutput({ b: "1", a: "0" });
        expect(output).toContain("_A = 0,");
        expect(output).toContain("_B = 1,");
    });

    test("still fail when the copies differ", async () => {
        await expect(cJSONOutput({ a: "0", b: "2" })).rejects.toThrow(
            "Cannot combine type attribute enumValues",
        );
    });
});
