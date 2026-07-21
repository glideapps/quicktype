import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
    FetchingJSONSchemaStore,
    InputData,
    JSONSchemaInput,
    quicktype,
} from "quicktype-core";
import { expect, test } from "vitest";

// Regression test for issue #2812: shells such as PowerShell pass wildcard
// arguments through literally, so a schema wildcard with no matching file must
// report a normal missing-file error rather than an internal error.
test("missing JSON Schema paths report the fetch error", async () => {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "quicktype-missing-schema-"),
    );
    const missingPath = path.join(tempDir, "*.json");

    try {
        const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());
        await schemaInput.addSource({ name: "TopLevel", uris: [missingPath] });
        const inputData = new InputData();
        inputData.addInput(schemaInput);

        await expect(
            quicktype({ inputData, lang: "typescript" }),
        ).rejects.toThrow(
            `Could not fetch schema #, referred to from ${missingPath}#`,
        );
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
