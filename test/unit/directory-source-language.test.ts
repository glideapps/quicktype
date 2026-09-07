import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { main } from "../../src";

const temporaryDirectories: string[] = [];

const personSchema = JSON.stringify({
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "person.schema.json",
    title: "Person",
    type: "object",
    properties: {
        name: { type: "string" },
        age: {
            description: "Age in years",
            type: "integer",
            minimum: 0,
        },
    },
    required: ["name"],
});

function makeTemporaryDirectory(): string {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "quicktype-directory-source-language-"),
    );
    temporaryDirectories.push(directory);
    return directory;
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("directory source language", () => {
    test("explicit schema source language applies to .schema.json files", async () => {
        const temporaryDirectory = makeTemporaryDirectory();
        const schemaDirectory = path.join(temporaryDirectory, "schemas");
        const schemaPath = path.join(schemaDirectory, "person.schema.json");
        const directOutputPath = path.join(
            temporaryDirectory,
            "direct",
            "output.ts",
        );
        const directoryOutputPath = path.join(
            temporaryDirectory,
            "directory",
            "output.ts",
        );

        fs.mkdirSync(schemaDirectory);
        fs.mkdirSync(path.dirname(directOutputPath));
        fs.mkdirSync(path.dirname(directoryOutputPath));
        fs.writeFileSync(schemaPath, personSchema);

        await main([
            "--src-lang",
            "schema",
            "--lang",
            "typescript",
            "--out",
            directOutputPath,
            "--top-level",
            "PersonSchema",
            schemaPath,
        ]);
        await main([
            "--src-lang",
            "schema",
            "--lang",
            "typescript",
            "--out",
            directoryOutputPath,
            "--top-level",
            "PersonSchema",
            schemaDirectory,
        ]);

        expect(fs.readFileSync(directoryOutputPath, "utf8")).toBe(
            fs.readFileSync(directOutputPath, "utf8"),
        );
    });

    test("default directory detection still recognizes .schema files", async () => {
        const temporaryDirectory = makeTemporaryDirectory();
        const schemaDirectory = path.join(temporaryDirectory, "schemas");
        const schemaPath = path.join(schemaDirectory, "person.schema");
        const outputPath = path.join(temporaryDirectory, "output.ts");

        fs.mkdirSync(schemaDirectory);
        fs.writeFileSync(schemaPath, personSchema);

        await main([
            "--lang",
            "typescript",
            "--out",
            outputPath,
            "--top-level",
            "PersonSchema",
            schemaDirectory,
        ]);

        const output = fs.readFileSync(outputPath, "utf8");
        expect(output).toContain("age?: number;");
        expect(output).not.toContain("$schema:");
    });
});
