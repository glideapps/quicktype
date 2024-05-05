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
    utf32ConcatMap
} from "../../support/Strings";

import * as keywords from "./constants";

export enum Strictness {
    Strict = "Strict::",
    Coercible = "Coercible::",
    None = "Types::"
}

export const forbiddenForObjectProperties = Array.from(new Set([...keywords.keywords, ...keywords.reservedProperties]));
function unicodeEscape(codePoint: number): string {
    return "\\u{" + intToHex(codePoint, 0) + "}";
}

export const stringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, unicodeEscape));

const isStartCharacter = isLetterOrUnderscore;

function isPartCharacter(utf16Unit: number): boolean {
    const category: string = unicode.getCategory(utf16Unit);
    return ["Nd", "Pc", "Mn", "Mc"].includes(category) || isStartCharacter(utf16Unit);
}

const legalizeName = legalizeCharacters(isPartCharacter);

export function simpleNameStyle(original: string, uppercase: boolean): string {
    if (/^[0-9]+$/.test(original)) {
        original = original + "N";
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
        isStartCharacter
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
        isStartCharacter
    );
}
