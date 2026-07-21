import { describe, expect, test } from "vitest";

import {
    InputData,
    type RendererOptions,
    jsonInputForTargetLanguage,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";

async function renderDart(
    rendererOptions: RendererOptions = {},
): Promise<string[]> {
    const jsonInput = jsonInputForTargetLanguage("dart");
    await jsonInput.addSource({
        name: "Sensordata",
        samples: ['{"sensor":"temp","data":[1,2,3]}'],
    });

    const inputData = new InputData();
    inputData.addInput(jsonInput);

    const result = await quicktype({
        inputData,
        lang: "dart",
        rendererOptions,
    });
    return result.lines;
}

describe("Dart JSON method names", () => {
    test("from-map only renames class-level map methods", async () => {
        const lines = await renderDart({ "from-map": "true" });

        expect(lines).toContain(
            "Sensordata sensordataFromJson(String str) => Sensordata.fromMap(json.decode(str));",
        );
        expect(lines).toContain(
            "String sensordataToJson(Sensordata data) => json.encode(data.toMap());",
        );
        expect(lines).toContain(
            "    factory Sensordata.fromMap(Map<String, dynamic> json) => Sensordata(",
        );
        expect(lines).toContain("    Map<String, dynamic> toMap() => {");
        expect(lines.some((line) => line.includes("sensordataFromMap"))).toBe(
            false,
        );
        expect(lines.some((line) => line.includes("sensordataToMap"))).toBe(
            false,
        );
    });

    test("uses Json names at both levels by default", async () => {
        const lines = await renderDart();

        expect(lines).toContain(
            "Sensordata sensordataFromJson(String str) => Sensordata.fromJson(json.decode(str));",
        );
        expect(lines).toContain(
            "String sensordataToJson(Sensordata data) => json.encode(data.toJson());",
        );
        expect(lines).toContain(
            "    factory Sensordata.fromJson(Map<String, dynamic> json) => Sensordata(",
        );
        expect(lines).toContain("    Map<String, dynamic> toJson() => {");
        expect(lines.some((line) => line.includes("fromMap"))).toBe(false);
        expect(lines.some((line) => line.includes("toMap"))).toBe(false);
    });
});
