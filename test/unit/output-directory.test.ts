import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, test } from "vitest";

import { type CLIOptions, writeOutput } from "../../src";

const multipleResults = new Map([
    ["Address.java", { lines: ["class Address {}"], annotations: [] }],
    ["Person.java", { lines: ["class Person {}"], annotations: [] }],
]);

function options(out: string): CLIOptions {
    return { out, quiet: true } as CLIOptions;
}

describe("CLI output paths", () => {
    test("writes multiple files inside an existing output directory", () => {
        const temporaryDirectory = fs.mkdtempSync(
            path.join(os.tmpdir(), "quicktype-output-"),
        );
        const outputDirectory = path.join(temporaryDirectory, "dist");
        fs.mkdirSync(outputDirectory);

        try {
            writeOutput(options(outputDirectory), multipleResults);

            expect(
                fs.readFileSync(
                    path.join(outputDirectory, "Address.java"),
                    "utf8",
                ),
            ).toBe("class Address {}");
            expect(
                fs.readFileSync(
                    path.join(outputDirectory, "Person.java"),
                    "utf8",
                ),
            ).toBe("class Person {}");
            expect(
                fs.existsSync(path.join(temporaryDirectory, "Address.java")),
            ).toBe(false);
            expect(
                fs.existsSync(path.join(temporaryDirectory, "Person.java")),
            ).toBe(false);
        } finally {
            fs.rmSync(temporaryDirectory, { recursive: true, force: true });
        }
    });

    test("creates a missing output directory for multiple files", () => {
        const temporaryDirectory = fs.mkdtempSync(
            path.join(os.tmpdir(), "quicktype-output-"),
        );
        const outputDirectory = path.join(
            temporaryDirectory,
            "dist",
            "newsub",
            "library",
        );

        try {
            writeOutput(options(outputDirectory), multipleResults);

            expect(fs.readdirSync(outputDirectory).sort()).toEqual([
                "Address.java",
                "Person.java",
            ]);
        } finally {
            fs.rmSync(temporaryDirectory, { recursive: true, force: true });
        }
    });

    test("writes a single file to the exact output path and creates its parent", () => {
        const temporaryDirectory = fs.mkdtempSync(
            path.join(os.tmpdir(), "quicktype-output-"),
        );
        const outputPath = path.join(
            temporaryDirectory,
            "dist",
            "newsub",
            "index.ts",
        );
        const singleResult = new Map([
            [
                "index.ts",
                { lines: ["export interface Person {}"], annotations: [] },
            ],
        ]);

        try {
            writeOutput(options(outputPath), singleResult);

            expect(fs.readFileSync(outputPath, "utf8")).toBe(
                "export interface Person {}",
            );
            expect(fs.statSync(outputPath).isFile()).toBe(true);
        } finally {
            fs.rmSync(temporaryDirectory, { recursive: true, force: true });
        }
    });
});
