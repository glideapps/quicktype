// The fixture in test/inputs/json/priority/name-style.json exercises names
// that collide with the acronym dictionary, but round-trip fixtures cannot
// detect identifier casing because generated identifiers are self-consistent.
// Assert on the emitted identifier here as a complement to that fixture.

import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { describe, expect, test } from "vitest";

const schema = JSON.stringify({
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
        name: { type: "string" },
    },
    required: ["name"],
});

async function renderTopLevel(topLevel: string): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name: topLevel, schema });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "typescript",
        rendererOptions: { "just-types": "true" },
    });
    return result.lines.join("\n");
}

describe("top-level acronym capitalization", () => {
    // A name written in mixed case carries an explicit capitalization that must
    // be respected even when it collides with the known-acronym dictionary
    // ("Acme" stays "Acme").  A uniformly cased name has no such signal, so a
    // dictionary match still styles it as an acronym ("acme" -> "ACME"), which
    // keeps names like a "json" property rendering as the acronym "JSON" and
    // avoids regressing library-collision fixtures (e.g. Klaxon's @Json).
    test.each([
        ["Acme", "Acme"],
        ["acme", "ACME"],
        ["ACME", "ACME"],
        ["HTMLParser", "HTMLParser"],
    ])("renders %s as %s", async (topLevel, expected) => {
        const output = await renderTopLevel(topLevel);

        expect(output).toContain(`export interface ${expected} {`);
    });
});
