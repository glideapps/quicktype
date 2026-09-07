import { describe, expect, test } from "vitest";

import {
    InputData,
    jsonInputForTargetLanguage,
    quicktypeMultiFile,
} from "quicktype-core";

async function cPlusPlusLeanFiles(): Promise<Map<string, string>> {
    const jsonInput = jsonInputForTargetLanguage("cplusplus");
    await jsonInput.addSource({
        name: "TopLevel",
        samples: [
            '{"child":{"name":"one"},"value":1}',
            '{"child":{"name":"two"},"value":2}',
        ],
    });

    const inputData = new InputData();
    inputData.addInput(jsonInput);
    const result = await quicktypeMultiFile({
        inputData,
        lang: "cplusplus",
        outputFilename: "TopLevel.cpp",
        rendererOptions: {
            "code-format": "with-struct",
            "include-location": "global-include",
            "lean-header": true,
        },
    });

    return new Map(
        Array.from(result, ([filename, serialized]) => [
            filename,
            serialized.lines.join("\n"),
        ]),
    );
}

describe("C++ lean header output", () => {
    test("emits a forward header, source shim, and implementation fragment", async () => {
        const files = await cPlusPlusLeanFiles();

        expect(Array.from(files.keys())).toEqual([
            "TopLevelFwd.hpp",
            "TopLevelFwd.cpp",
            "TopLevel.inc",
        ]);

        const header = files.get("TopLevelFwd.hpp");
        expect(header).toContain("#include <nlohmann/json_fwd.hpp>");
        expect(header).not.toContain("#include <nlohmann/json.hpp>");
        expect(header).toContain("struct TopLevel");

        const source = files.get("TopLevelFwd.cpp");
        expect(source).toContain('#include "TopLevelFwd.hpp"');
        expect(source).toContain('#include "TopLevel.inc"');
        expect(source).toContain("#include <nlohmann/json.hpp>");

        const implementation = files.get("TopLevel.inc");
        expect(implementation).toContain("void from_json");
        expect(implementation).not.toContain("inline void from_json");
        expect(implementation).not.toContain("struct TopLevel {");
    });
});
