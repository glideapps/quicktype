import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { main as quicktype } from "../../src";

let temporaryDirectory: string;
let eventsDirectory: string;

beforeAll(() => {
    temporaryDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "quicktype-directory-schema-"),
    );
    eventsDirectory = path.join(temporaryDirectory, "events");
    fs.mkdirSync(eventsDirectory);

    fs.writeFileSync(
        path.join(temporaryDirectory, "event.json"),
        JSON.stringify({
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "Event",
            type: "object",
            properties: {
                id: { type: "string" },
                name: { type: "string" },
            },
            required: ["name"],
        }),
    );

    for (const eventNumber of [1, 2]) {
        fs.writeFileSync(
            path.join(eventsDirectory, `event${eventNumber}.json`),
            JSON.stringify({
                $schema: "http://json-schema.org/draft-07/schema#",
                title: `Event${eventNumber}`,
                allOf: [
                    { $ref: "../event.json" },
                    {
                        type: "object",
                        properties: {
                            type: {
                                type: "string",
                                enum: [
                                    `type${eventNumber}a`,
                                    `type${eventNumber}b`,
                                ],
                            },
                            payload: { type: "object" },
                        },
                    },
                ],
            }),
        );
    }
});

afterAll(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("directory schema input", () => {
    test("treats JSON files as schemas when --src-lang schema is used", async () => {
        const outputPath = path.join(temporaryDirectory, "output.swift");

        await quicktype({
            srcLang: "schema",
            src: [eventsDirectory],
            lang: "swift",
            out: outputPath,
            quiet: true,
            telemetry: "disable",
            rendererOptions: {
                "just-types": true,
                "struct-or-class": "class",
            },
        });

        const output = fs.readFileSync(outputPath, "utf8");

        expect(output).toContain("class Event1 {");
        expect(output).toContain("class Event2 {");
        expect(output.match(/let name: String/g)).toHaveLength(2);
        expect(output.match(/let payload: \[String: Any\?\]\?/g)).toHaveLength(
            2,
        );
        expect(output).toContain("case type1A");
        expect(output).toContain("case type1B");
        expect(output).toContain("case type2A");
        expect(output).toContain("case type2B");
        expect(output).not.toMatch(/let (schema|title|allOf):/);
        expect(output).not.toMatch(/struct Event[12] \{/);
    });
});
