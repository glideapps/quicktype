// Regression test for #1655. With `--converters all-objects` the JavaScript
// renderer emits a `to<Type>`/`<type>ToJson` converter pair for every object
// type, not just the top-level ones. Before the fix, `emitModuleExports()`
// still iterated only the top-level types, so those extra per-object
// converters were generated in the module body but never listed in
// `module.exports` — callers of the module could not reach them.
//
// A round-trip fixture cannot catch this: the driver deserializes and
// reserializes through the top-level converter, which is exported and works
// regardless of whether the nested converters are. This test therefore
// generates the module directly and inspects its `module.exports` block.

import {
    InputData,
    jsonInputForTargetLanguage,
    quicktype,
} from "quicktype-core";
import { describe, expect, test } from "vitest";

// A schema with a nested object (`data123`) so the all-objects renderer emits a
// converter for a non-top-level type.
const sample = JSON.stringify({ data123: { name: "quicktype" } });

async function renderJavaScript(converters: string): Promise<string> {
    const jsonInput = jsonInputForTargetLanguage("js");
    await jsonInput.addSource({ name: "TopLevel", samples: [sample] });
    const inputData = new InputData();
    inputData.addInput(jsonInput);

    const result = await quicktype({
        inputData,
        lang: "js",
        rendererOptions: { "acronym-style": "pascal", converters },
    });
    return result.lines.join("\n");
}

// The `module.exports = { ... };` object literal at the bottom of the module.
function moduleExportsBlock(source: string): string {
    const match = source.match(/module\.exports\s*=\s*\{([\s\S]*?)\};/);
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper is only called from within tests
    expect(match, `no module.exports block in:\n${source}`).not.toBeNull();
    return match?.[1] ?? "";
}

// Every converter the module defines — `function to<Name>(json)` and
// `function <name>ToJson(value)`. The module's helpers (cast, uncast,
// transform, …) have different signatures and are intentionally not matched.
function definedConverters(source: string): string[] {
    return [
        ...source.matchAll(/^function (to[A-Z]\w*)\(json\)/gm),
        ...source.matchAll(/^function (\w+ToJson)\(value\)/gm),
    ].map((m) => m[1]);
}

describe("JavaScript converters: all-objects module.exports", () => {
    test("exports a converter for every object type, including nested ones", async () => {
        const source = await renderJavaScript("all-objects");
        const converters = definedConverters(source);
        const exportsBlock = moduleExportsBlock(source);

        // Sanity: the renderer actually emitted a nested-object converter.
        expect(converters).toContain("toData123");
        expect(converters).toContain("data123ToJson");

        // The invariant #1655 restores: every defined converter is exported.
        for (const name of converters) {
            expect(
                exportsBlock,
                `converter ${name} is defined but not in module.exports`,
            ).toContain(name);
        }
    });

    test("top-level mode exports only top-level converters", async () => {
        const source = await renderJavaScript("top-level");
        const exportsBlock = moduleExportsBlock(source);

        expect(exportsBlock).toContain("toTopLevel");
        // The nested converter is not generated in top-level mode, so it must
        // not appear in the exports either — this is what distinguishes the
        // all-objects behavior above from the default.
        expect(exportsBlock).not.toContain("toData123");
    });
});
