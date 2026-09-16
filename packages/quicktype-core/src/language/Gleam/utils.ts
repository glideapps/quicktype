import {
    escapeNonPrintableMapper,
    intToHex,
    isPrintable,
    utf32ConcatMap,
} from "../../support/Strings.js";

function standardUnicodeGleamEscape(codePoint: number): string {
    // Gleam string escapes use the `\u{...}` form.
    return `\\u{${intToHex(codePoint, 4)}}`;
}

export const gleamStringEscape = utf32ConcatMap(
    escapeNonPrintableMapper(isPrintable, standardUnicodeGleamEscape),
);
