import { funPrefixNamer } from "../../Naming";
import {
    allLowerWordStyle,
    allUpperWordStyle,
    combineWords,
    escapeNonPrintableMapper,
    firstUpperWordStyle,
    isAscii,
    isDigit,
    isLetter,
    isPrintable,
    splitIntoWords,
    standardUnicodeHexEscape,
    utf16ConcatMap,
    utf16LegalizeCharacters
} from "../../support/Strings";

export const typeNamingFunction = funPrefixNamer("types", n => dartNameStyle(true, false, n));
export const propertyNamingFunction = funPrefixNamer("properties", n => dartNameStyle(false, false, n));
export const enumCaseNamingFunction = funPrefixNamer("enum-cases", n => dartNameStyle(true, true, n));

// Escape the dollar sign, which is used in string interpolation
export const stringEscape = utf16ConcatMap(
    escapeNonPrintableMapper(cp => isPrintable(cp) && cp !== 0x24, standardUnicodeHexEscape)
);

function isStartCharacter(codePoint: number): boolean {
    if (codePoint === 0x5f) return false; // underscore
    return isAscii(codePoint) && isLetter(codePoint);
}

function isPartCharacter(codePoint: number): boolean {
    return isStartCharacter(codePoint) || (isAscii(codePoint) && isDigit(codePoint));
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

// FIXME: Handle acronyms consistently.  In particular, that means that
// we have to use namers to produce the getter and setter names - we can't
// just capitalize and concatenate.
// https://stackoverflow.com/questions/8277355/naming-convention-for-upper-case-abbreviations
export function dartNameStyle(startWithUpper: boolean, upperUnderscore: boolean, original: string): string {
    const words = splitIntoWords(original);
    const firstWordStyle = upperUnderscore
        ? allUpperWordStyle
        : startWithUpper
          ? firstUpperWordStyle
          : allLowerWordStyle;
    const restWordStyle = upperUnderscore ? allUpperWordStyle : firstUpperWordStyle;
    return combineWords(
        words,
        legalizeName,
        firstWordStyle,
        restWordStyle,
        firstWordStyle,
        restWordStyle,
        upperUnderscore ? "_" : "",
        isStartCharacter
    );
}
