import { describe, expect, test } from "vitest";

import {
    InputData,
    jsonInputForTargetLanguage,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";

async function generate(
    lang: string,
    outputFilename?: string,
): Promise<string> {
    const jsonInput = jsonInputForTargetLanguage(lang);
    await jsonInput.addSource({
        name: "ExperimentCounts",
        samples: ['{"experiments": 3}'],
    });

    const inputData = new InputData();
    inputData.addInput(jsonInput);
    const result = await quicktype({
        inputData,
        lang,
        outputFilename,
    });
    return result.lines.join("\n");
}

describe("output filename in usage comments", () => {
    test("uses output filename in TypeScript usage imports", async () => {
        const output = await generate(
            "typescript",
            "src/cli/ExperimentCounts.ts",
        );

        expect(output).toContain(
            '//   import { Convert, ExperimentCounts } from "./ExperimentCounts";',
        );
        expect(output).not.toContain('from "./file"');
    });

    test("uses output filename in JavaScript usage require", async () => {
        const output = await generate(
            "javascript",
            "src/cli/ExperimentCounts.js",
        );

        expect(output).toContain(
            '//   const Convert = require("./ExperimentCounts");',
        );
        expect(output).not.toContain('require("./file")');
    });

    test("uses output filename in Flow usage require", async () => {
        const output = await generate("flow", "ExperimentCounts.js");

        expect(output).toContain(
            '//   const Convert = require("./ExperimentCounts");',
        );
        expect(output).not.toContain('require("./file")');
    });

    test('falls back to "file" when writing to stdout', async () => {
        const tsOutput = await generate("typescript");
        expect(tsOutput).toContain(' } from "./file";');

        const jsOutput = await generate("javascript");
        expect(jsOutput).toContain('//   const Convert = require("./file");');
    });
});
