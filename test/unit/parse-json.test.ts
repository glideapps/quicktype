import { describe, expect, it } from "vitest";

import { parseJSON } from "quicktype-core";

describe("parseJSON", () => {
    it("parses strict JSON", () => {
        expect(parseJSON('{"name":"quicktype","count":2}', "test")).toEqual({
            count: 2,
            name: "quicktype",
        });
    });

    it("falls back to YAML", () => {
        expect(parseJSON("name: quicktype\ncount: 2\n", "test")).toEqual({
            count: 2,
            name: "quicktype",
        });
    });

    it("accepts a byte-order mark before strict JSON", () => {
        expect(parseJSON('\ufeff{"name":"quicktype"}', "test")).toEqual({
            name: "quicktype",
        });
    });
});
