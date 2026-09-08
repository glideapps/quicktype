import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";
import { expect, test } from "vitest";

async function renderEffectSchema(schema: object): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "TopLevel",
        schema: JSON.stringify(schema),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);
    const result = await quicktype({
        inputData,
        lang: "typescript-effect-schema",
    });
    return result.lines.join("\n");
}

test("Effect Schema emits the map helper only for map types", async () => {
    const objectOutput = await renderEffectSchema({
        type: "object",
        properties: { value: { type: "boolean" } },
    });
    const mapOutput = await renderEffectSchema({
        type: "object",
        additionalProperties: { type: "boolean" },
    });

    expect(objectOutput).not.toContain("const mapSchema");
    expect(objectOutput).not.toContain("const objectSchema");
    expect(mapOutput).toContain("const mapSchema");
    expect(mapOutput).toContain("const objectSchema");
    expect(mapOutput).toContain("mapSchema(S.Boolean)");
});
