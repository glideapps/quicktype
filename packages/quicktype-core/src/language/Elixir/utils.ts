import unicode from "unicode-properties";

import {
    allLowerWordStyle,
    allUpperWordStyle,
    combineWords,
    escapeNonPrintableMapper,
    firstUpperWordStyle,
    intToHex,
    isLetterOrUnderscore,
    isPrintable,
    legalizeCharacters,
    splitIntoWords,
    utf32ConcatMap,
} from "../../support/Strings";

function unicodeEscape(codePoint: number): string {
    return `\\u{${intToHex(codePoint, 0)}}`;
}

export function capitalizeFirstLetter(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

export const stringEscape = utf32ConcatMap(
    escapeNonPrintableMapper(isPrintable, unicodeEscape),
);

export function escapeDoubleQuotes(str: string): string {
    return str.replace(/"/g, '\\"');
}

export function escapeNewLines(str: string): string {
    return str.replace(/\n/g, "\\n");
}

const isStartCharacter = isLetterOrUnderscore;

function isPartCharacter(utf16Unit: number): boolean {
    const category: string = unicode.getCategory(utf16Unit);
    return (
        ["Nd", "Pc", "Mn", "Mc"].includes(category) ||
        isStartCharacter(utf16Unit)
    );
}

const legalizeName = legalizeCharacters(isPartCharacter);

export function simpleNameStyle(original: string, uppercase: boolean): string {
    if (/^[0-9]+$/.test(original)) {
        original = `${original}N`;
    }

    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        uppercase ? firstUpperWordStyle : allLowerWordStyle,
        uppercase ? firstUpperWordStyle : allLowerWordStyle,
        allUpperWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter,
    );
}

export function memberNameStyle(original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        allLowerWordStyle,
        allLowerWordStyle,
        allLowerWordStyle,
        allLowerWordStyle,
        "_",
        isStartCharacter,
    );
}
