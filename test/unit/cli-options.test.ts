import { describe, expect, test } from "vitest";

import { parseCLIOptions } from "../../src/index.js";

describe("CLI option parsing", () => {
    test("reports a duplicate output option as a user input error", () => {
        expect(() =>
            parseCLIOptions(["-o", "list.go", "-o", "list.ts"]),
        ).toThrow(/^Option parsing failed: .*Singular option already set/);

        expect(() =>
            parseCLIOptions(["-o", "list.go", "-o", "list.ts"]),
        ).not.toThrow("Internal error");
    });
});
