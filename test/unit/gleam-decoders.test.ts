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

// A decoder that reaches itself and omits `decode.recursive` compiles clean,
// then hangs forever at construction time.
// Fixture tests cannot catch this — the job simply times out — so assert the
// guarded set exactly here: a missing guard hangs, while a superfluous guard
// rebuilds the decoder once per decoded value.
function decoderGuards(output: string): {
    decoders: string[];
    guarded: string[];
} {
    const lines = output.split("\n");
    const decoders: string[] = [];
    const guarded: string[] = [];
    lines.forEach((line, index) => {
        const match = /^pub fn (\w+_decoder)\(/.exec(line);
        if (match === null) {
            return;
        }

        decoders.push(match[1]);
        // A header may span multiple lines when its return type is long; the
        // body starts on the line after the one ending in `{`.
        let bodyIndex = index;
        while (!lines[bodyIndex].endsWith("{")) {
            bodyIndex += 1;
        }

        if (lines[bodyIndex + 1].trim() === "use <- decode.recursive") {
            guarded.push(match[1]);
        }
    });
    return { decoders, guarded };
}

test("a self-recursive class decoder is guarded", async () => {
    // The recursive field comes first, so without the guard construction
    // recurses before any other combinator can run.
    const output = await gleamFromJSON("Tree", [
        JSON.stringify({
            children: [{ children: [], value: 2 }],
            value: 1,
        }),
    ]);

    const { decoders, guarded } = decoderGuards(output);
    expect(decoders).toEqual(["tree_decoder"]);
    expect(guarded).toEqual(["tree_decoder"]);
});

test("mutual recursion through a union is guarded", async () => {
    const output = await gleamFromSchema(
        JSON.stringify({
            $ref: "#/definitions/Node",
            definitions: {
                Node: {
                    type: "object",
                    additionalProperties: false,
                    properties: { value: { $ref: "#/definitions/Value" } },
                    required: ["value"],
                },
                Value: {
                    oneOf: [{ $ref: "#/definitions/Node" }, { type: "string" }],
                },
            },
        }),
    );

    const { decoders, guarded } = decoderGuards(output);
    expect(decoders).toEqual(["top_level_decoder", "value_decoder"]);
    // One lazy point per cycle suffices: with the class guarded, calling
    // `value_decoder()` constructs `top_level_decoder()` in O(1), so the
    // union decoder needs no guard of its own.
    expect(guarded).toEqual(["top_level_decoder"]);
});

test("`json_value_decoder` is always guarded", async () => {
    const output = await gleamFromSchema(
        JSON.stringify({ type: ["string", "integer", "array", "object"] }),
    );

    const { decoders, guarded } = decoderGuards(output);
    expect(decoders).toEqual(["json_value_decoder", "top_level_decoder"]);
    expect(guarded).toEqual(["json_value_decoder"]);
});

test("a flat object emits no `decode.recursive` at all", async () => {
    const output = await gleamFromJSON("Flat", [
        JSON.stringify({ a: 1, b: "x" }),
    ]);

    const { decoders, guarded } = decoderGuards(output);
    expect(decoders).toEqual(["flat_decoder"]);
    expect(guarded).toEqual([]);
    expect(output).not.toContain("decode.recursive");
});

test("an enum decoder is unguarded", async () => {
    // The body is a string `case` with literal success/failure arms and no
    // child decoder, so it cannot re-enter itself.
    const output = await gleamFromSchema(
        JSON.stringify({ type: "string", enum: ["hot", "cold"] }),
    );

    const { decoders, guarded } = decoderGuards(output);
    expect(decoders).toEqual(["top_level_decoder"]);
    expect(guarded).toEqual([]);
});

test("a top-level array decoder is unguarded", async () => {
    const output = await gleamFromSchema(
        JSON.stringify({
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: { a: { type: "integer" } },
                required: ["a"],
            },
        }),
    );

    const { decoders, guarded } = decoderGuards(output);
    expect(decoders).toEqual([
        "top_level_element_decoder",
        "top_level_decoder",
    ]);
    expect(guarded).toEqual([]);
});

// `JsonValue` matches every input, so the variant that decodes to it must
// come last in a `one_of` or it would shadow the others. The bare `any`
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

// `Int` and `Float` are distinct Gleam types, but quicktype widens mixed
// number samples to a `Float` field, so a whole number like `123` must still
// decode. `decode.float` rejects ints on the Erlang target, hence the lenient
// `one_of` with an `int.to_float` fallback.
test("a plain Float field keeps the lenient number decoder and its import", async () => {
    const output = await gleamFromJSON("Bar", [
        JSON.stringify([{ foo: 1.5 }, { foo: 2.5 }]),
    ]);

    expect(output).toContain("foo: Float");
    expect(output).toContain(
        "decode.one_of(decode.float, [decode.map(decode.int, int.to_float)])",
    );
    expect(output).toContain("import gleam/int");
});

// A call with no arguments has nothing to break on, so `gleam format` keeps it
// on one line however far past column 80 it sits. Splitting `head(` from `)`
// makes `gleam format --check src/` reject the module. A ~70-character decoder
// name nested three lists deep is the shortest input that reaches the limit.
test("a zero-argument call past column 80 stays on one line", async () => {
    const output = await gleamFromJSON(
        "AVeryLongTopLevelNameForTestingSignatureWrappingBehaviour",
        [JSON.stringify([[[{ a: 1 }]]])],
    );

    expect(output).toContain(
        "a_very_long_top_level_name_for_testing_signature_wrapping_behaviour_element_decoder(),",
    );
    expect(output).not.toMatch(/_decoder\(\n\s*\)/);
});
