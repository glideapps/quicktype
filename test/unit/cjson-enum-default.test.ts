import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { describe, expect, test } from "vitest";

const schema = JSON.stringify({
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
        subscription: {
            type: "string",
            enum: ["state", "config", "heartbeat"],
        },
    },
    required: ["subscription"],
});

async function cJSONOutput(): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name: "TopLevel", schema });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "cjson" });
    return result.lines.join("\n");
}

describe("cJSON enum invalid value", () => {
    test("does not collide with a real enumerator", async () => {
        const output = await cJSONOutput();

        expect(output).toContain(`enum Subscription {
    SUBSCRIPTION_STATE = 1,
    SUBSCRIPTION_CONFIG,
    SUBSCRIPTION_HEARTBEAT,
};`);
        expect(output).toContain("enum Subscription x = 0;");
    });
});
