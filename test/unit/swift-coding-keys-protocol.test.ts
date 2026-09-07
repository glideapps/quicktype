import { describe, expect, test } from "vitest";

import {
    InputData,
    jsonInputForTargetLanguage,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";

describe("Swift coding keys protocol", () => {
    test("emits redundant coding keys when a protocol is requested", async () => {
        const input = jsonInputForTargetLanguage("swift");
        await input.addSource({ name: "TopLevel", samples: ['{"value": 1}'] });
        const inputData = new InputData();
        inputData.addInput(input);

        const result = await quicktype({
            inputData,
            lang: "swift",
            rendererOptions: { "coding-keys-protocol": "CaseIterable" },
        });

        expect(result.lines.join("\n")).toContain(
            "enum CodingKeys: String, CodingKey, CaseIterable",
        );
    });
});
