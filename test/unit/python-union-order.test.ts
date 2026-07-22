import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";
import { expect, test } from "vitest";

const schema = JSON.stringify({
    type: ["integer", "number"],
});

// Schema fixtures use JSON.parse, which unifies JSON integers and floats as
// JavaScript numbers (5 and 5.0 compare identically), so assert source order.
test("Python tries integer before number in unions", async () => {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name: "TopLevel", schema });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "python" });
    const output = result.lines.join("\n");

    expect(output).toContain("from_union([from_int, from_float]");
    expect(output).toContain("from_union([from_int, to_float]");
});
