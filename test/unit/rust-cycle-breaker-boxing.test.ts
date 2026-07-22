import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";
import { describe, expect, test } from "vitest";

async function renderRust(next: object, requireNext = false): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "Node",
        schema: JSON.stringify({
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "Node",
            type: "object",
            properties: {
                value: { type: "string" },
                next,
            },
            required: requireNext ? ["value", "next"] : ["value"],
        }),
    });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "rust" });
    return result.lines.join("\n");
}

const recursiveUnionMembers = [{ $ref: "#" }, { type: "string" }];

describe("Rust cycle-breaker boxing", () => {
    test("does not box an Option whose union member is already boxed", async () => {
        const output = await renderRust({
            anyOf: [...recursiveUnionMembers, { type: "null" }],
        });

        expect(output).toContain("pub next: Option<Box<Next>>,");
        expect(output).not.toContain("Box<Option<Box<Next>>>");
    });

    test("keeps a non-nullable cycle-breaking union boxed", async () => {
        const output = await renderRust({ anyOf: recursiveUnionMembers }, true);

        expect(output).toContain("pub next: Box<Next>,");
    });
});
