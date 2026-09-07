import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { expect, test } from "vitest";

import { main as quicktype } from "../../src";

test("treats JSON files in a schema directory as JSON Schemas", async () => {
    const temporaryDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "quicktype-directory-schema-"),
    );
    const schemaDirectory = path.join(temporaryDirectory, "schemas");
    const outputPath = path.join(temporaryDirectory, "Models.ts");
    fs.mkdirSync(schemaDirectory);

    fs.writeFileSync(
        path.join(schemaDirectory, "alert_schema.json"),
        JSON.stringify({
            type: "object",
            properties: { issue_id: { type: "string" } },
            required: ["issue_id"],
            additionalProperties: false,
        }),
    );
    fs.writeFileSync(
        path.join(schemaDirectory, "incident_schema.json"),
        JSON.stringify({
            type: "object",
            properties: { incident_code: { type: "integer" } },
            required: ["incident_code"],
            additionalProperties: false,
        }),
    );

    try {
        await quicktype({
            srcLang: "schema",
            src: [schemaDirectory],
            lang: "typescript",
            out: outputPath,
            quiet: true,
            telemetry: "disable",
        });

        const output = fs.readFileSync(outputPath, "utf8");
        expect(output).toMatch(
            /export interface AlertSchema \{\s+issue_id: string;\s+\}/,
        );
        expect(output).toMatch(
            /export interface IncidentSchema \{\s+incident_code: number;\s+\}/,
        );
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});
