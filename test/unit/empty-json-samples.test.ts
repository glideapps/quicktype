// addSource with an empty samples array used to succeed silently and
// quicktype would render full converter boilerplate for a type with no
// evidence whatsoever. An empty samples array is almost always a caller bug
// (a glob that matched nothing, a filtered list that came up empty), so it
// must fail loudly instead — see
// https://github.com/glideapps/quicktype/issues/2934.

import { describe, expect, test } from "vitest";

import {
    InputData,
    jsonInputForTargetLanguage,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";

describe("JSON input with empty samples", () => {
    test("addSource throws a clear error", async () => {
        const jsonInput = jsonInputForTargetLanguage("typescript");
        await expect(
            jsonInput.addSource({ name: "X", samples: [] }),
        ).rejects.toThrow("No JSON samples given for top-level X");
    });

    test("addSourceSync throws a clear error", () => {
        const jsonInput = jsonInputForTargetLanguage("typescript");
        expect(() =>
            jsonInput.addSourceSync({ name: "X", samples: [] }),
        ).toThrow("No JSON samples given for top-level X");
    });

    test("non-empty samples still generate code", async () => {
        const jsonInput = jsonInputForTargetLanguage("typescript");
        await jsonInput.addSource({
            name: "Person",
            samples: ['{"name":"Alice","age":30}'],
        });

        const inputData = new InputData();
        inputData.addInput(jsonInput);
        const result = await quicktype({ inputData, lang: "typescript" });

        expect(result.lines.join("\n")).toContain("Person");
    });
});
