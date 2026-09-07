import { describe, expect, test } from "vitest";

import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";

describe("TypeScript readonly", () => {
    test("applies to index signatures", async () => {
        const input = new JSONSchemaInput(undefined);
        await input.addSource({
            name: "TopLevel",
            schema: JSON.stringify({
                type: "object",
                properties: { fixed: { type: "string" } },
                required: ["fixed"],
                additionalProperties: { type: "string" },
            }),
        });
        const inputData = new InputData();
        inputData.addInput(input);

        const result = await quicktype({
            inputData,
            lang: "typescript",
            rendererOptions: { readonly: "true" },
        });

        expect(result.lines.join("\n")).toContain(
            "readonly [property: string]: string;",
        );
    });

    test("applies to map types", async () => {
        const input = new JSONSchemaInput(undefined);
        await input.addSource({
            name: "TopLevel",
            schema: JSON.stringify({
                type: "object",
                additionalProperties: { type: "string" },
            }),
        });
        const inputData = new InputData();
        inputData.addInput(input);

        const result = await quicktype({
            inputData,
            lang: "typescript",
            rendererOptions: { readonly: "true" },
        });

        expect(result.lines.join("\n")).toContain(
            "{ readonly [key: string]: string }",
        );
    });
});
