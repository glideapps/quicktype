// cJSON can split its output into header/source pairs (header-only=false)
// and can emit one file per type (source-style=multi-source).  The first
// version of the split emitted a `#include <ClassName.c>` self-include at
// the top of every generated source file (an unguarded self-include that
// recurses at compile time), referenced generated headers with angle
// brackets instead of the quoted-include convention, and made every header
// include itself in the pre-existing multi-source header-only mode.  These
// tests pin down the include structure of the generated files.
import { describe, expect, test } from "vitest";

import {
    InputData,
    type RendererOptions,
    jsonInputForTargetLanguage,
    quicktypeMultiFile,
} from "quicktype-core";

async function cJSONFiles(
    rendererOptions: RendererOptions,
    outputFilename = "TopLevel.h",
): Promise<Map<string, string>> {
    const jsonInput = jsonInputForTargetLanguage("cjson");
    await jsonInput.addSource({
        name: "TopLevel",
        samples: [
            '{"child": {"n": 1}, "color": "red", "value": 1}',
            '{"child": {"n": 2}, "color": "green", "value": "s"}',
        ],
    });
    const inputData = new InputData();
    inputData.addInput(jsonInput);
    const result = await quicktypeMultiFile({
        inputData,
        lang: "cjson",
        outputFilename,
        rendererOptions,
    });
    return new Map(
        Array.from(result, ([filename, serialized]) => [
            filename,
            serialized.lines.join("\n"),
        ]),
    );
}

function includesIn(source: string): string[] {
    return source.match(/#include [<"][^>"]+[>"]/g) ?? [];
}

describe("cJSON multi-source header/source pairs", () => {
    const rendererOptions: RendererOptions = {
        "source-style": "multi-source",
        "header-only": false,
    };

    test("every header gets a source file", async () => {
        const files = await cJSONFiles(rendererOptions);
        const names = Array.from(files.keys());
        const headers = names.filter((name) => name.endsWith(".h"));
        expect(headers.length).toBeGreaterThan(2);
        for (const header of headers) {
            expect(names).toContain(header.replace(/\.h$/, ".c"));
        }
    });

    test("no generated file includes itself", async () => {
        const files = await cJSONFiles(rendererOptions);
        for (const [filename, source] of files) {
            expect(includesIn(source)).not.toContain(`#include "${filename}"`);
            expect(includesIn(source)).not.toContain(`#include <${filename}>`);
        }
    });

    test("generated files are included with quotes, not angle brackets", async () => {
        const files = await cJSONFiles(rendererOptions);
        for (const [, source] of files) {
            for (const include of includesIn(source)) {
                const match = /#include <([^>]+)>/.exec(include);
                if (match === null) {
                    continue;
                }

                // Angle brackets are reserved for system and vendored
                // headers; a generated file must never appear in them.
                expect(files.has(match[1])).toBe(false);
            }
        }
    });

    test("each source file includes its own header first", async () => {
        const files = await cJSONFiles(rendererOptions);
        for (const [filename, source] of files) {
            if (!filename.endsWith(".c")) {
                continue;
            }

            const header = filename.replace(/\.c$/, ".h");
            expect(includesIn(source)[0]).toBe(`#include "${header}"`);
        }
    });
});

describe("cJSON multi-source header-only mode", () => {
    test("emits no source files and no header includes itself", async () => {
        const files = await cJSONFiles({ "source-style": "multi-source" });
        expect(files.size).toBeGreaterThan(2);
        for (const [filename, source] of files) {
            expect(filename).toMatch(/\.h$/);
            expect(includesIn(source)).not.toContain(`#include "${filename}"`);
            expect(includesIn(source)).not.toContain(`#include <${filename}>`);
        }
    });
});

describe("cJSON source filename derivation", () => {
    test("only a trailing .h is swapped for .c", async () => {
        // `.replace(".h", ".c")` would have produced "my.couse.h".
        const files = await cJSONFiles({ "header-only": false }, "my.house.h");
        expect(Array.from(files.keys()).sort()).toEqual([
            "my.house.c",
            "my.house.h",
        ]);
    });
});
