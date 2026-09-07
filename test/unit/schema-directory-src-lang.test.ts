import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, test } from "vitest";

import { main } from "../../src/index.js";

const locationSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "location.json",
    title: "Location",
    type: "object",
    properties: {
        latitude: { type: "number" },
        longitude: { type: "number" },
    },
    required: ["latitude", "longitude"],
};

const personSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "person.json",
    title: "Person",
    type: "object",
    properties: {
        name: { type: "string" },
        location: { $ref: "location.json" },
    },
    required: ["name", "location"],
};

const productSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "product.json",
    title: "Product",
    type: "object",
    properties: {
        name: { type: "string" },
        price: { type: "number" },
        location: { $ref: "location.json" },
    },
    required: ["name", "price", "location"],
};

describe("schema input directories (issue #2634)", () => {
    test("treats .json files as schemas when --src-lang schema is given", async () => {
        const tempDir = fs.mkdtempSync(
            path.join(os.tmpdir(), "quicktype-schema-directory-"),
        );
        try {
            const schemaDir = path.join(tempDir, "schemas");
            fs.mkdirSync(schemaDir);

            const schemas = [
                ["location.json", locationSchema],
                ["person.json", personSchema],
                ["product.json", productSchema],
            ] as const;
            for (const [filename, schema] of schemas) {
                fs.writeFileSync(
                    path.join(schemaDir, filename),
                    JSON.stringify(schema),
                );
            }

            const directoryOutput = path.join(tempDir, "directory.rs");
            await main([
                "--lang",
                "rust",
                "--src-lang",
                "schema",
                "--out",
                directoryOutput,
                "--src",
                schemaDir,
            ]);

            const filesOutput = path.join(tempDir, "files.rs");
            await main([
                "--lang",
                "rust",
                "--src-lang",
                "schema",
                "--out",
                filesOutput,
                ...schemas.flatMap(([filename]) => [
                    "--src",
                    path.join(schemaDir, filename),
                ]),
            ]);

            expect(fs.readFileSync(directoryOutput, "utf8")).toBe(
                fs.readFileSync(filesOutput, "utf8"),
            );
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
