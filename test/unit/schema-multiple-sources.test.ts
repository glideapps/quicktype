// Regression test for issue #1543: when one top-level JSON Schema source
// references another, both sources must resolve to the same generated type.
//
// This lives as a unit test rather than a round-trip schema fixture because
// the bug is a *duplicate* structurally identical interface: both the buggy
// and the fixed output round-trip the sample JSON identically, so the fixture
// harness cannot observe the difference.  A directory (multi-source) fixture
// also can't run through that harness, since it yields multiple top-level
// types whose per-type entry points don't match the shared drivers' single
// `fromJsonString`/top-level assumption.  The schemas in
// test/inputs/schema/multi-source-1543 are the input for this test.

import * as path from "node:path";

import {
    FetchingJSONSchemaStore,
    InputData,
    JSONSchemaInput,
    quicktype,
} from "quicktype-core";
import { describe, expect, test } from "vitest";

const schemaDirectory = path.resolve("test/inputs/schema/multi-source-1543");

async function generateTypeScript(): Promise<string> {
    const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());
    await schemaInput.addSource({
        name: "OrderCustomer",
        uris: [path.join(schemaDirectory, "OrderCustomer.schema")],
    });
    await schemaInput.addSource({
        name: "TopLevel",
        uris: [path.join(schemaDirectory, "TopLevel.schema")],
    });

    const inputData = new InputData();
    inputData.addInput(schemaInput);
    const result = await quicktype({
        inputData,
        lang: "typescript",
        rendererOptions: { "just-types": true },
    });
    return result.lines.join("\n");
}

describe("top-level schemas referenced by another source (issue #1543)", () => {
    test("reuses the top-level type for a cross-file $ref", async () => {
        const output = await generateTypeScript();

        expect(output).toMatch(/info:\s+OrderCustomer;/);
        expect(output).not.toContain("export interface Info");
    });
});
