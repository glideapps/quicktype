import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";

import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";

async function render(schema: object): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "TopLevel",
        schema: JSON.stringify(schema),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);
    const result = await quicktype({ inputData, lang: "typescript-zod" });
    return result.lines.join("\n");
}

function evaluate(output: string): Record<string, unknown> {
    const directory = fs.mkdtempSync(path.join(process.cwd(), ".tmp-zod-map-"));
    try {
        fs.writeFileSync(path.join(directory, "TopLevel.ts"), output);
        fs.writeFileSync(
            path.join(directory, "main.ts"),
            `import { TopLevelSchema } from "./TopLevel";
const input = Object.create(null);
Object.defineProperty(input, "__proto__", { value: 1, enumerable: true, writable: true, configurable: true });
const parsed = TopLevelSchema.parse(input);
const typed: Record<string, number> = parsed;
// @ts-expect-error Map values are numbers.
const invalid: string = parsed.value;
console.log(JSON.stringify({
    prototype: Object.getPrototypeOf(parsed) === Object.prototype,
    descriptor: Object.getOwnPropertyDescriptor(parsed, "__proto__"),
    rejects: [new Date(), new Map(), new Set()].map(value => !TopLevelSchema.safeParse(value).success),
}));`,
        );
        execFileSync(
            path.join(process.cwd(), "node_modules/.bin/tsc"),
            [
                "--ignoreConfig",
                "--noEmit",
                "--skipLibCheck",
                "--moduleResolution",
                "bundler",
                "--target",
                "ES2020",
                "--module",
                "preserve",
                path.join(directory, "main.ts"),
            ],
            { timeout: 60_000 },
        );
        return JSON.parse(
            execFileSync(
                path.join(process.cwd(), "node_modules/.bin/tsx"),
                [path.join(directory, "main.ts")],
                { encoding: "utf8", timeout: 60_000 },
            ),
        );
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

describe("TypeScript Zod map helper", () => {
    test("preserves record behavior and prototype-named keys", async () => {
        const output = await render({
            type: "object",
            additionalProperties: { type: "integer" },
        });
        const result = evaluate(output);

        expect(result).toEqual({
            prototype: true,
            descriptor: {
                value: 1,
                writable: true,
                enumerable: true,
                configurable: true,
            },
            rejects: [true, true, true],
        });
    }, 60_000);
});
