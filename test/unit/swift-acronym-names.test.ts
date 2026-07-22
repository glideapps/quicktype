// The fixture harness cannot catch acronym casing in Swift type names: the
// generated identifiers are self-consistent, so the code still compiles and
// round-trips JSON successfully. Generate Swift directly and assert on the
// emitted struct declaration instead.

import {
    InputData,
    jsonInputForTargetLanguage,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";
import { describe, expect, test } from "vitest";

async function swiftStructName(acronymStyle: string): Promise<string> {
    const jsonInput = jsonInputForTargetLanguage("swift");
    await jsonInput.addSource({
        name: "FaqCoordinate",
        samples: ['{"x":1,"y":2}'],
    });

    const inputData = new InputData();
    inputData.addInput(jsonInput);

    const result = await quicktype({
        inputData,
        lang: "swift",
        rendererOptions: { "acronym-style": acronymStyle },
    });
    const output = result.lines.join("\n");
    const match = output.match(/^struct (\w+): Codable \{$/m);

    // biome-ignore lint/suspicious/noMisplacedAssertion: helper is only called from within tests
    expect(match, `generated Swift output:\n${output}`).not.toBeNull();
    return match?.[1] ?? "";
}

describe("Swift leading acronym casing", () => {
    test.each([
        ["original", "FaqCoordinate"],
        ["pascal", "FAQCoordinate"],
        ["camel", "FaqCoordinate"],
        ["lowerCase", "faqCoordinate"],
    ])("honors acronym-style=%s for struct names", async (acronymStyle, expectedName) => {
        await expect(swiftStructName(acronymStyle)).resolves.toBe(expectedName);
    });
});
