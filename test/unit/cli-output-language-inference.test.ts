import { describe, expect, test } from "vitest";

import { parseCLIOptions } from "../../src/index.js";

describe("CLI output-language inference", () => {
    test("infers JSON Schema from a .json output filename", () => {
        const options = parseCLIOptions(["-o", "schema.json", "input.json"]);

        expect(options.lang).toBe("schema");
        expect(options.srcLang).toBe("json");
    });

    test("keeps json as an explicit source language", () => {
        const options = parseCLIOptions([
            "--lang",
            "schema",
            "--src-lang",
            "json",
            "input.json",
        ]);

        expect(options.lang).toBe("schema");
        expect(options.srcLang).toBe("json");
    });

    test("does not treat json as an explicit output language", () => {
        expect(() => parseCLIOptions(["--lang", "json", "input.json"])).toThrow(
            "Unknown output language json",
        );
    });
});
