import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { describe, expect, test } from "vitest";

async function render(properties: Record<string, unknown>): Promise<string> {
    const input = new JSONSchemaInput(undefined);
    await input.addSource({
        name: "TopLevel",
        schema: JSON.stringify({
            type: "object",
            properties,
            required: Object.keys(properties),
        }),
    });
    const inputData = new InputData();
    inputData.addInput(input);
    return (await quicktype({ inputData, lang: "typescript-zod" })).lines.join(
        "\n",
    );
}

describe("TypeScript Zod date and time schemas", () => {
    test("emits each used format schema once", async () => {
        const output = await render({
            firstDate: { type: "string", format: "date" },
            secondDate: { type: "string", format: "date" },
            firstTime: { type: "string", format: "time" },
            secondTime: { type: "string", format: "time" },
            firstDateTime: { type: "string", format: "date-time" },
            secondDateTime: { type: "string", format: "date-time" },
        });

        expect(output.match(/const dateSchema =/g)).toHaveLength(1);
        expect(output.match(/const timeSchema =/g)).toHaveLength(1);
        expect(output.match(/const dateTimeSchema =/g)).toHaveLength(1);
        expect(output.match(/: dateSchema/g)).toHaveLength(2);
        expect(output.match(/: timeSchema/g)).toHaveLength(2);
        expect(output.match(/: dateTimeSchema/g)).toHaveLength(2);
    });

    test.each([
        "date",
        "time",
        "date-time",
    ])("emits only the %s format schema", async (format) => {
        const output = await render({
            value: { type: "string", format },
        });

        for (const [schema, schemaFormat] of [
            ["dateSchema", "date"],
            ["timeSchema", "time"],
            ["dateTimeSchema", "date-time"],
        ]) {
            expect(output.includes(`const ${schema} =`)).toBe(
                schemaFormat === format,
            );
        }
    });

    test("omits format schemas for plain strings", async () => {
        const output = await render({ value: { type: "string" } });
        expect(output).not.toMatch(/const (?:date|time|dateTime)Schema =/);
    });
});
