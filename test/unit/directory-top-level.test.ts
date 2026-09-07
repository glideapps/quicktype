import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { main as quicktype } from "../../src";

const temporaryDirectories: string[] = [];

function makeInputDirectory(files: Record<string, unknown>): string {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "quicktype-directory-top-level-"),
    );
    temporaryDirectories.push(tempDir);

    const inputDir = path.join(tempDir, "input");
    for (const [relativePath, contents] of Object.entries(files)) {
        const filename = path.join(inputDir, relativePath);
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, JSON.stringify(contents));
    }

    return inputDir;
}

async function generateSchema(
    inputDir: string,
    topLevel?: string,
): Promise<Record<string, unknown>> {
    const output = path.join(
        path.dirname(inputDir),
        `${topLevel ?? "default"}.schema`,
    );
    const args = ["--lang", "schema", "--out", output];
    if (topLevel !== undefined) {
        args.push("--top-level", topLevel);
    }
    args.push(inputDir);

    await quicktype(args);
    return JSON.parse(fs.readFileSync(output, "utf8"));
}

afterEach(() => {
    for (const tempDir of temporaryDirectories.splice(0)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

describe("directory input top-level names (issue #2538)", () => {
    test.each([
        ["one file at the directory root", "sample.json", "Sample"],
        ["one type subdirectory", "person/sample.json", "Person"],
    ])("uses an explicit top-level name for %s", async (_, filename, defaultName) => {
        const inputDir = makeInputDirectory({
            [filename]: { name: "Alice", age: 30 },
        });

        const explicitSchema = await generateSchema(inputDir, "Foo");
        expect(explicitSchema.$ref).toBe("#/definitions/Foo");
        expect(explicitSchema.definitions).toHaveProperty("Foo");

        const defaultSchema = await generateSchema(inputDir);
        expect(defaultSchema.$ref).toBe(`#/definitions/${defaultName}`);
        expect(defaultSchema.definitions).toHaveProperty(defaultName);
    });

    test("leaves multi-type directory behavior unchanged", async () => {
        const inputDir = makeInputDirectory({
            "person/sample.json": { name: "Alice" },
            "car/sample.json": { make: "Toyota" },
        });

        const schema = await generateSchema(inputDir, "Foo");
        expect(schema).not.toHaveProperty("$ref");
        expect(schema.definitions).toHaveProperty("Person");
        expect(schema.definitions).toHaveProperty("Car");
        expect(schema.definitions).not.toHaveProperty("Foo");
    });
});
