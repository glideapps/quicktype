import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { describe, expect, test } from "vitest";

async function renderJava(
    propertySchema: object,
    name = "TopLevel",
): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name,
        schema: JSON.stringify({
            type: "object",
            properties: { value: propertySchema },
        }),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    return (await quicktype({ inputData, lang: "java" })).lines.join("\n");
}

describe("Java strict calendar validation", () => {
    test("are emitted only for date-time types", async () => {
        const plain = await renderJava({ type: "string" });
        const dateTime = await renderJava({
            type: "string",
            format: "date-time",
        });

        expect(plain).not.toContain("ResolverStyle");
        expect(await renderJava({ type: "string" }, "ResolverStyle")).toContain(
            "class ResolverStyle",
        );
        expect(dateTime).toContain("ResolverStyle.STRICT");
        expect(dateTime).toContain("DATE_TIME_FORMATTER");
    });
});
