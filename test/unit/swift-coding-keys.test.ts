import { describe, expect, test } from "vitest";

import {
    InputData,
    jsonInputForTargetLanguage,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";

describe("Swift coding keys", () => {
    test("can omit explicit coding keys", async () => {
        const input = jsonInputForTargetLanguage("swift");
        await input.addSource({
            name: "TopLevel",
            samples: ['{"snake_case": 1}'],
        });
        const inputData = new InputData();
        inputData.addInput(input);

        const result = await quicktype({
            inputData,
            lang: "swift",
            rendererOptions: { "coding-keys": "false" },
        });

        expect(result.lines.join("\n")).not.toContain("enum CodingKeys");
    });
});
