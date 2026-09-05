// The fixture harness always supplies each language's configured top-level
// name, and round trips cannot detect identifier casing because generated
// identifiers are self-consistent. Generate directly to assert the requested
// top-level name.

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
    // A single mixed-case name carries explicit capitalization that must be
    // respected even when it collides with the known-acronym dictionary
    // ("Acme" stays "Acme").  Uniformly cased names and acronym words within
    // compound names keep the existing acronym-style behavior.
    test.each([
        ["Acme", "Acme"],
        ["acme", "ACME"],
        ["ACME", "ACME"],
        ["HTMLParser", "HTMLParser"],
        ["FaqCoordinate", "FAQCoordinate"],
    ])("renders %s as %s", async (topLevel, expected) => {
        const output = await renderTopLevel(topLevel);

        expect(output).toContain(`export interface ${expected} {`);
    });
});
