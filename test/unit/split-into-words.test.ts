// `splitIntoWords` decides which word intervals are acronyms, which drives how
// every target language cases identifiers.  A fully-uppercase *single* word
// (e.g. a custom enum value like "DASH") must be recognized as an acronym so it
// is preserved verbatim (issue #1915).  But a fully-uppercase *multi-word*
// input (e.g. "RANK_TITLE") must NOT collapse into a single acronym token:
// doing so loses the word boundary and breaks naming round-trips through JSON
// Schema (regression seen in the bug863.json diff-via-schema fixture).

import { describe, expect, test } from "vitest";

import { splitIntoWords } from "../../packages/quicktype-core/src/support/Strings.js";

describe("splitIntoWords acronym detection", () => {
    test("treats a fully-uppercase single word as an acronym", () => {
        expect(splitIntoWords("DASH")).toEqual([
            { word: "DASH", isAcronym: true },
        ]);
        expect(splitIntoWords("MSS")).toEqual([
            { word: "MSS", isAcronym: true },
        ]);
    });

    test("does not treat a fully-uppercase multi-word input as acronyms", () => {
        expect(splitIntoWords("RANK_TITLE")).toEqual([
            { word: "RANK", isAcronym: false },
            { word: "TITLE", isAcronym: false },
        ]);
    });

    test("keeps recognizing uppercase runs in mixed-case input", () => {
        expect(splitIntoWords("getHTTPResponse")).toEqual([
            { word: "get", isAcronym: false },
            { word: "HTTP", isAcronym: true },
            { word: "Response", isAcronym: false },
        ]);
    });
});
