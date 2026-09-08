import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";
import { expect, test } from "vitest";

async function renderElm(schema: object): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "TopLevel",
        schema: JSON.stringify(schema),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);
    const result = await quicktype({ inputData, lang: "elm" });
    return result.lines.join("\n");
}

test("Elm emits the dictionary encoder only for map types", async () => {
    const objectOutput = await renderElm({
        type: "object",
        properties: { value: { type: "boolean" } },
    });
    const mapOutput = await renderElm({
        type: "object",
        additionalProperties: { type: "boolean" },
    });

    expect(objectOutput).not.toContain("makeDictEncoder :");
    expect(mapOutput).toContain("makeDictEncoder :");
    expect(mapOutput).toContain("makeDictEncoder identity Jenc.bool");
});
