// The fixture runner exercises this multi-file input end to end, but duplicate
// structural interfaces still compile.  Assert here that the dead interface is
// not generated.
import * as fs from "node:fs";
import * as path from "node:path";

import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";
import { describe, expect, test } from "vitest";

const fixtureDirectory = "test/inputs/schema/issue-1833";

async function generateTypeScript(): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    for (const filename of ["a.schema", "b.schema", "c.schema"]) {
        const fixturePath = path.resolve(fixtureDirectory, filename);
        await schemaInput.addSource({
            name: path.basename(filename, ".schema"),
            schema: fs.readFileSync(fixturePath, "utf8"),
            uris: [fixturePath],
        });
    }

    const inputData = new InputData();
    inputData.addInput(schemaInput);
    const result = await quicktype({
        inputData,
        lang: "typescript",
        rendererOptions: { "just-types": true },
    });
    return result.lines.join("\n");
}

describe("JSON Schema multiple sources (issue #1833)", () => {
    test("a top-level schema and references to its $id share one type", async () => {
        const output = await generateTypeScript();

        expect(output).toContain("in:   C[];");
        expect(output).toContain("out:  C[];");
        expect(output.match(/export interface C/g)).toHaveLength(1);
        expect(output).not.toContain("export interface InElement");
    });
});
