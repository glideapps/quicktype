import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";
import { expect, test } from "vitest";

const schema = JSON.stringify({
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    required: ["format"],
    properties: {
        format: {
            anyOf: [{ $ref: "#/definitions/DataFormat" }, { type: "null" }],
        },
    },
    definitions: {
        DataFormat: {
            title: "DataFormat",
            oneOf: [
                { title: "Turtle", type: "string", enum: ["turtle"] },
                { title: "RDF XML", type: "string", enum: ["rdf_xml"] },
                {
                    title: "N-Triples",
                    type: "string",
                    enum: ["n_triples"],
                },
                { title: "N-Quads", type: "string", enum: ["n_quads"] },
            ],
        },
    },
});

// The fixture harness verifies round-tripping, but generated identifiers are
// self-consistent even when the wrong title is chosen.  Assert the emitted name
// directly so the outer oneOf title cannot regress to the first variant title.
test("uses the outer oneOf title for a nullable enum-of-enums", async () => {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name: "Out", schema });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "typescript",
        rendererOptions: { "prefer-types": true },
    });
    const output = result.lines.join("\n");

    expect(output).toContain("format: DataFormat | null;");
    expect(output).toContain(
        'export type DataFormat = "turtle" | "rdf_xml" | "n_triples" | "n_quads";',
    );
    expect(output).not.toMatch(/export type Turtle\b/);
});
