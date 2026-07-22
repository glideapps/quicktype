// Maps of empty objects render as `Map<String, X>` with `typealias X =
// JsonObject` in Kotlin/Klaxon. Klaxon's reflective deserializer never
// consults custom converters for map values, so it tries to construct the
// JsonObject values via reflection and fails with "Couldn't find a suitable
// constructor for class JsonObject to initialize with {}". Fields holding
// such maps must instead be handled by a field-level converter, which Klaxon
// does consult (https://github.com/glideapps/quicktype/issues/2881).
import { expect, test } from "vitest";

import {
    InputData,
    jsonInputForTargetLanguage,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";

async function kotlinKlaxonForSamples(samples: string[]): Promise<string> {
    const jsonInput = jsonInputForTargetLanguage("kotlin");
    await jsonInput.addSource({ name: "TopLevel", samples });

    const inputData = new InputData();
    inputData.addInput(jsonInput);

    const result = await quicktype({
        inputData,
        lang: "kotlin",
        rendererOptions: { framework: "klaxon" },
    });
    return result.lines.join("\n");
}

// The repro from issue #2881 (minimized from #2037's fixture): sibling maps
// where one has empty-object entries and the other is empty.
const bug2881 = JSON.stringify({
    mission_specs: {
        "1": { objectives: { "2": { rewards: { "3": {}, "5": {} } } } },
        "4": { objectives: { "6": { rewards: {} } } },
    },
});

test("map-of-empty-object fields get a Klaxon field converter", async () => {
    const output = await kotlinKlaxonForSamples([bug2881]);

    // Empty objects still render as a JsonObject typealias.
    expect(output).toContain("typealias Reward = JsonObject");

    // The field-level converter must be declared and registered...
    expect(output).toContain("@Target(AnnotationTarget.FIELD)");
    expect(output).toContain("private annotation class KlaxonJsonObjectMap");
    expect(output).toContain(
        ".fieldConverter(KlaxonJsonObjectMap::class, jsonObjectMapConverter)",
    );

    // ...and the map-of-empty-object property must be annotated with it.
    expect(output).toContain(
        "@KlaxonJsonObjectMap\n    val rewards: Map<String, Reward>",
    );
});

test("maps nested inside maps of empty objects are annotated", async () => {
    const nested = JSON.stringify({
        outer: { "1": { "2": {}, "3": {} }, "4": { "5": {} } },
    });
    const output = await kotlinKlaxonForSamples([nested]);

    expect(output).toContain(
        "@KlaxonJsonObjectMap\n    val outer: Map<String, Map<String, Outer>>",
    );
});

test("plain classes and maps of non-empty objects are not annotated", async () => {
    const sample = JSON.stringify({
        plain: { x: 1 },
        widgets: { "1": { x: 1 }, "4": { x: 2 } },
    });
    const output = await kotlinKlaxonForSamples([sample]);

    // `widgets` renders as `Map<String, Plain>`, which Klaxon deserializes
    // fine on its own, so none of the workaround machinery should appear.
    expect(output).toContain("val widgets: Map<String, Plain>");
    expect(output).not.toContain("KlaxonJsonObjectMap");
    expect(output).not.toContain("fieldConverter");
});
