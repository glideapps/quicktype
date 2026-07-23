import { readFileSync } from "node:fs";

import {
    FetchingJSONSchemaStore,
    InputData,
    JSONSchemaInput,
    quicktype,
} from "quicktype-core";
import { expect, test } from "vitest";

test("TypeScript preserves a named root array and its object item type", async () => {
    const schema = readFileSync(
        new URL("../inputs/schema/root-array-ref.schema", import.meta.url),
        "utf8",
    );
    const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());
    await schemaInput.addSource({ name: "PR", schema });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "typescript" });
    const output = result.lines.join("\n");

    expect(output).toContain("export interface SomeObject");
    expect(output).toContain("export type PR = SomeObject[];");
    expect(output).not.toContain("export interface PR");
});
