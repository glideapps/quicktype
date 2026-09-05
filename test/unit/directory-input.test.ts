import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { expect, test } from "vitest";

import { main as quicktype } from "../../src";

test("honors schema source language for JSON files in a directory", async () => {
    const temporaryDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "quicktype-directory-"),
    );
    const schemaDirectory = path.join(temporaryDirectory, "schemas");
    const outputPath = path.join(temporaryDirectory, "out.ts");
    fs.mkdirSync(schemaDirectory);

    fs.writeFileSync(
        path.join(schemaDirectory, "Name.json"),
        JSON.stringify({
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "string",
            pattern: "^[a-zA-Z0-9]+$",
        }),
    );
    fs.writeFileSync(
        path.join(schemaDirectory, "AnotherName.json"),
        JSON.stringify({
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "string",
            pattern: "^\\d+$",
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

        expect(output).toContain("type AnotherName = string;");
        expect(output).toContain("type Name = string;");
        expect(output).not.toContain("$schema");
        expect(output).not.toContain("export interface Name");
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});
