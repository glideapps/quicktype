import {
    FetchingJSONSchemaStore,
    InputData,
    JSONSchemaInput,
    quicktype,
} from "quicktype-core";
import { describe, expect, test } from "vitest";

function objectAlternative(property: string, closed: boolean): object {
    return {
        type: "object",
        ...(closed ? { additionalProperties: false } : {}),
        properties: { [property]: { type: "string" } },
    };
}

async function render(
    keyword: "oneOf" | "anyOf",
    closed: boolean,
): Promise<string> {
    const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());
    await schemaInput.addSource({
        name: "TopLevel",
        schema: JSON.stringify({
            [keyword]: [
                objectAlternative("alpha", closed),
                objectAlternative("beta", closed),
            ],
        }),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "typescript" });
    return result.lines.join("\n");
}

describe("JSON Schema object unions", () => {
    test("uses exclusive TypeScript guards only for closed oneOf members", async () => {
        const closed = await render("oneOf", true);
        const open = await render("oneOf", false);
        const anyOf = await render("anyOf", true);

        expect(closed).toContain('"alpha"?: never');
        expect(closed).toContain('"beta"?: never');
        expect(open).not.toContain("?: never");
        expect(anyOf).not.toContain("?: never");
    });
});
