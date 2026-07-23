// Unit tests for the Windows-paths-as-"file:"-URIs protocol (issue #2869):
// fixWindowsPath converts Windows absolute schema addresses to "file:" URIs
// before urijs parses them, and filePathFromFileURI converts them back to
// file paths when NodeIO reads them from disk. The end-to-end pipeline is
// covered by windows-schema-paths.test.ts; these tests pin down the string
// mapping itself, including the inputs that must pass through untouched.

import {
    filePathFromFileURI,
    fixWindowsPath,
} from "quicktype-core/dist/support/WindowsPaths.js";
import { describe, expect, test } from "vitest";

describe("fixWindowsPath", () => {
    test.each([
        // Drive-letter paths become "file:///<drive>:/..." URIs.
        [
            "C:\\Users\\me\\top.schema.json",
            "file:///C:/Users/me/top.schema.json",
        ],
        ["C:/Users/me/top.schema.json", "file:///C:/Users/me/top.schema.json"],
        ["c:\\dir\\x.json", "file:///c:/dir/x.json"],
        ["Z:/x.json", "file:///Z:/x.json"],
        // Mixed separators are normalized to forward slashes.
        ["C:\\dir/sub\\x.json", "file:///C:/dir/sub/x.json"],
        // Spaces survive: the address machinery works with decoded URIs.
        ["C:\\My Dir\\x.json", "file:///C:/My Dir/x.json"],
        // UNC paths keep the server as the URI host.
        ["\\\\server\\share\\x.json", "file://server/share/x.json"],
        ["\\\\server\\share\\dir\\x.json", "file://server/share/dir/x.json"],
    ])("converts %j to %j", (input, expected) => {
        expect(fixWindowsPath(input)).toBe(expected);
    });

    test.each([
        // POSIX and relative paths are not Windows paths.
        "/home/me/top.schema.json",
        "dir/top.schema.json",
        "./top.schema.json",
        "../top.schema.json",
        "top.schema.json",
        "",
        // Real URIs must never be re-wrapped.
        "http://example.com/x.schema.json",
        "https://example.com/x.schema.json",
        "file:///C:/dir/x.json",
        "file://server/share/x.json",
        // Drive-letter lookalikes: more than one letter is a URI scheme,
        // digits are not drive letters, and "C:x" (no separator after the
        // colon, a drive-relative path) is not supported.
        "CC:\\x.json",
        "1:\\x.json",
        "C:",
        "C:x.json",
        // A single leading backslash is not UNC.
        "\\dir\\x.json",
    ])("passes %j through unchanged", (input) => {
        expect(fixWindowsPath(input)).toBe(input);
    });
});

describe("filePathFromFileURI", () => {
    test.each([
        // Drive-letter URIs lose the leading slash so fs sees "C:/...".
        ["file:///C:/dir/x.json", "C:/dir/x.json"],
        ["file:///c:/dir/x.json", "c:/dir/x.json"],
        ["file:///C:/My Dir/x.json", "C:/My Dir/x.json"],
        // UNC URIs turn the host back into a "//server/..." path.
        ["file://server/share/x.json", "//server/share/x.json"],
        // POSIX file URIs keep their absolute path.
        ["file:///home/me/x.json", "/home/me/x.json"],
        ["file:///x.json", "/x.json"],
    ])("converts %j to %j", (input, expected) => {
        expect(filePathFromFileURI(input)).toBe(expected);
    });
});

describe("round-trip", () => {
    test.each([
        // filePathFromFileURI(fixWindowsPath(p)) yields the forward-slash
        // form of p, which is what Node's fs accepts on every platform.
        ["C:\\Users\\me\\top.schema.json", "C:/Users/me/top.schema.json"],
        ["C:/Users/me/top.schema.json", "C:/Users/me/top.schema.json"],
        ["\\\\server\\share\\x.json", "//server/share/x.json"],
    ])("%j reads back as %j", (input, expected) => {
        expect(filePathFromFileURI(fixWindowsPath(input))).toBe(expected);
    });
});
