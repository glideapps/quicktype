import { expect, test } from "vitest";

import {
    InputData,
    JSONSchemaInput,
    jsonInputForTargetLanguage,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";

async function gleamFromJSON(name: string, samples: string[]): Promise<string> {
    const jsonInput = jsonInputForTargetLanguage("gleam");
    await jsonInput.addSource({ name, samples });
    const inputData = new InputData();
    inputData.addInput(jsonInput);
    const result = await quicktype({ inputData, lang: "gleam" });
    return result.lines.join("\n");
}

async function gleamFromSchema(schema: string): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name: "TopLevel", schema });
    const inputData = new InputData();
    inputData.addInput(schemaInput);
    const result = await quicktype({ inputData, lang: "gleam" });
    return result.lines.join("\n");
}

// Rule 1 (highest severity): a decoder that reaches itself and omits
// `decode.recursive` compiles clean, then hangs forever at construction time.
// Fixture tests cannot catch this — the job simply times out — so assert the
// guard on every generated decoder here.
test("every Gleam decoder opens with `use <- decode.recursive`", async () => {
    const output = await gleamFromJSON("Tree", [
        JSON.stringify({
            value: 1,
            label: "root",
            children: [{ value: 2, label: "leaf", children: [] }],
        }),
    ]);

    const lines = output.split("\n");
    const headerIndices = lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /^pub fn \w+_decoder\(/.test(line))
        .map(({ index }) => index);

    expect(headerIndices.length).toBeGreaterThan(0);
    for (const headerIndex of headerIndices) {
        // A header may span multiple lines when its return type is long; the
        // body starts on the line after the one ending in `{`.
        let bodyIndex = headerIndex;
        while (!lines[bodyIndex].endsWith("{")) {
            bodyIndex += 1;
        }

        expect(lines[bodyIndex + 1].trim()).toBe("use <- decode.recursive");
    }
});

// Rule 3: `JsonValue` matches every input, so the variant that decodes to it
// must come last in a `one_of` or it would shadow the others. The bare `any`
// member is absorbed by the type IR, but the same "universal match last"
// invariant is realized inside `json_value_decoder`, whose `decode.success`
// catch-all always succeeds and therefore must be the final alternative.
test("the universal `JsonValue` catch-all is emitted last", async () => {
    const output = await gleamFromSchema(
        JSON.stringify({ type: ["string", "integer", "array", "object"] }),
    );

    const start = output.indexOf("pub fn json_value_decoder()");
    expect(start).toBeGreaterThanOrEqual(0);
    const decoder = output.slice(start, output.indexOf("\n}", start));

    const catchAll = decoder.indexOf("decode.success(JsonNull)");
    const listVariant = decoder.indexOf("JsonArray");
    const dictVariant = decoder.indexOf("JsonObject");
    expect(catchAll).toBeGreaterThan(listVariant);
    expect(catchAll).toBeGreaterThan(dictVariant);

    // The catch-all is the final alternative: nothing follows it but the
    // closing delimiters of the `one_of`.
    expect(decoder.slice(catchAll)).not.toContain("decode.map");
});
