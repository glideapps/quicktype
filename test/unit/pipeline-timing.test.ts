import { describe, expect, it } from "vitest";

import {
    InputData,
    JSONSchemaInput,
    type QuicktypeTiming,
    jsonInputForTargetLanguage,
    quicktype,
} from "quicktype-core";

describe("pipeline timing", () => {
    it("reports input processing and rendering", async () => {
        const jsonInput = jsonInputForTargetLanguage("typescript");
        await jsonInput.addSource({
            name: "Example",
            samples: ['{"id": 1, "name": "quicktype"}'],
        });
        const inputData = new InputData();
        inputData.addInput(jsonInput);
        const timings: QuicktypeTiming[] = [];

        await quicktype({
            inputData,
            lang: "typescript",
            onTiming: (timing) => timings.push(timing),
        });

        expect(timings.some(({ name }) => name === "read input")).toBe(true);
        expect(timings.some(({ name }) => name === "render")).toBe(true);
        expect(timings.every(({ milliseconds }) => milliseconds >= 0)).toBe(
            true,
        );
    });

    it("reports JSON Schema parsing separately", async () => {
        const schemaInput = new JSONSchemaInput(undefined);
        await schemaInput.addSource({
            name: "Example",
            schema: JSON.stringify({
                properties: { id: { type: "integer" } },
                type: "object",
            }),
        });
        const inputData = new InputData();
        inputData.addInput(schemaInput);
        const names: string[] = [];

        await quicktype({
            inputData,
            lang: "typescript",
            onTiming: ({ name }) => names.push(name),
        });

        expect(names).toContain("parse JSON Schema");
        expect(names).toContain("read input");
        expect(names).toContain("render");
    });
});
