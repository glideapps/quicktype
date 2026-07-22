import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";
import { expect, test } from "vitest";

const schema = JSON.stringify({
    type: "object",
    properties: {
        value: {},
    },
    required: ["value"],
});

test("emits modern Hashable implementation for JSONNull by default", async () => {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name: "TopLevel", schema });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "swift" });
    const output = result.lines.join("\n");

    expect(output).toContain("public func hash(into hasher: inout Hasher)");
    expect(output).toContain("hasher.combine(0)");
    expect(output).not.toContain("public var hashValue: Int");
});
