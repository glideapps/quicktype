import vm from "node:vm";

import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { expect, test } from "vitest";

test("JavaScript converters return plain objects for prototype-named keys", async () => {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "TopLevel",
        schema: JSON.stringify({
            type: "object",
            additionalProperties: { type: "boolean" },
        }),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);
    const result = await quicktype({ inputData, lang: "javascript" });
    const module = { exports: {} as Record<string, (json: string) => object> };

    vm.runInNewContext(result.lines.join("\n"), { module, Object });
    const converted = module.exports.toTopLevel('{"__proto__":true}');

    expect(Object.getPrototypeOf(converted)).toBe(Object.prototype);
});
