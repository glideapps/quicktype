import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { expect, test } from "vitest";

import { main as quicktype } from "../../src";

test("treats JSON and extensionless files in a directory as schemas with -s schema", async () => {
    const temporaryDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "quicktype-directory-schema-"),
    );
    const schemaDirectory = path.join(temporaryDirectory, "schemas");
    const outputPath = path.join(temporaryDirectory, "out.ts");
    fs.mkdirSync(schemaDirectory);
    fs.writeFileSync(
        path.join(schemaDirectory, "MyInterface.json"),
        JSON.stringify({
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "MyInterface",
            type: "object",
            properties: {
                name: { type: "string" },
                age: { type: "integer" },
            },
            required: ["name", "age"],
        }),
    );
    fs.writeFileSync(
        path.join(schemaDirectory, "Extensionless"),
        JSON.stringify({
            type: "object",
            properties: { active: { type: "boolean" } },
            required: ["active"],
        }),
    );

    try {
        await quicktype({
            srcLang: "schema",
            src: [schemaDirectory],
            lang: "typescript",
            out: outputPath,
            rendererOptions: { "just-types": true },
            quiet: true,
            telemetry: "disable",
        });

        const output = fs.readFileSync(outputPath, "utf8");
        expect(output).toContain("export interface MyInterface");
        expect(output).toMatch(/name:\s+string;/);
        expect(output).toMatch(/age:\s+number;/);
        expect(output).toContain("export interface Extensionless");
        expect(output).toMatch(/active:\s+boolean;/);
        expect(output).not.toContain("$schema:");
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});
