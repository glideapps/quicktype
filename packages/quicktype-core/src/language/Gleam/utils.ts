import { funPrefixNamer } from "../../Naming.js";
import {
    allLowerWordStyle,
    combineWords,
    escapeNonPrintableMapper,
    firstUpperWordStyle,
    intToHex,
    isAscii,
    isLetterOrUnderscore,
    isLetterOrUnderscoreOrDigit,
    isPrintable,
    legalizeCharacters,
    splitIntoWords,
    utf32ConcatMap,
} from "../../support/Strings.js";

function isAsciiLetterOrUnderscoreOrDigit(codePoint: number): boolean {
    if (!isAscii(codePoint)) {
        return false;
    }

    return isLetterOrUnderscoreOrDigit(codePoint);
}

function isAsciiLetterOrUnderscore(codePoint: number): boolean {
    if (!isAscii(codePoint)) {
        return false;
    }

    return isLetterOrUnderscore(codePoint);
}

const legalizeName = legalizeCharacters(isAsciiLetterOrUnderscoreOrDigit);

function gleamStyle(original: string, isSnakeCase: boolean): string {
    const words = splitIntoWords(original);

    const wordStyle = isSnakeCase ? allLowerWordStyle : firstUpperWordStyle;

    const combined = combineWords(
        words,
        legalizeName,
        wordStyle,
        wordStyle,
        wordStyle,
        wordStyle,
        isSnakeCase ? "_" : "",
        isAsciiLetterOrUnderscore,
    );

    return combined === "_" ? "_underscore" : combined;
}

// snake_case, for functions, record fields, and local values.
export const snakeNamingFunction = funPrefixNamer(
    "default",
    (original: string) => gleamStyle(original, true),
);

// PascalCase, for type names, record/union constructors, and enum cases.
export const pascalNamingFunction = funPrefixNamer(
    "pascal",
    (original: string) => gleamStyle(original, false),
);

function standardUnicodeGleamEscape(codePoint: number): string {
    // Gleam string escapes use the `\u{...}` form.
    return `\\u{${intToHex(codePoint, 4)}}`;
}

export const gleamStringEscape = utf32ConcatMap(
    escapeNonPrintableMapper(isPrintable, standardUnicodeGleamEscape),
);
