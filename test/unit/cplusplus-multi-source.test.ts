import { describe, expect, test } from "vitest";

import {
    InputData,
    jsonInputForTargetLanguage,
    quicktypeMultiFile,
} from "quicktype-core";

async function cPlusPlusMultiSourceFiles(): Promise<Map<string, string>> {
    const jsonInput = jsonInputForTargetLanguage("cplusplus");
    await jsonInput.addSource({
        name: "ChunkCache",
        samples: ['{"chunks":["one"],"size":1}'],
    });
    await jsonInput.addSource({
        name: "BufferPath",
        samples: ['{"path":"somewhere","maxSize":2}'],
    });

    const inputData = new InputData();
    inputData.addInput(jsonInput);
    const result = await quicktypeMultiFile({
        inputData,
        lang: "cplusplus",
        outputFilename: "quicktype.hpp",
        rendererOptions: { "source-style": "multi-source" },
    });

    return new Map(
        Array.from(result, ([filename, serialized]) => [
            filename,
            serialized.lines.join("\n"),
        ]),
    );
}

describe("C++ multi-source output", () => {
    test("the umbrella header includes the JSON generators", async () => {
        const files = await cPlusPlusMultiSourceFiles();
        expect(files.get("quicktype.hpp")).toContain(
            '#include "Generators.hpp"',
        );
    });

    test("usage comments name top-level types, not generated files", async () => {
        const files = await cPlusPlusMultiSourceFiles();
        for (const [filename, source] of files) {
            expect(source).toContain(
                "//     ChunkCache data = nlohmann::json::parse(jsonString);",
            );
            expect(source).toContain(
                "//     BufferPath data = nlohmann::json::parse(jsonString);",
            );
            expect(source).not.toContain(
                `//     ${filename} data = nlohmann::json::parse(jsonString);`,
            );
        }
    });
});
