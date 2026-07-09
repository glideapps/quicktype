import {
    allLowerWordStyle,
    allUpperWordStyle,
    combineWords,
    escapeNonPrintableMapper,
    firstUpperWordStyle,
    isAscii,
    isDigit,
    isLetter,
    splitIntoWords,
    standardUnicodeHexEscape,
    utf16ConcatMap,
    utf16LegalizeCharacters,
} from "../../support/Strings";

export const stringEscape = utf16ConcatMap(
    escapeNonPrintableMapper(isAscii, standardUnicodeHexEscape),
);

function isStartCharacter(codePoint: number): boolean {
    if (codePoint === 0x5f) return true; // underscore
    return isAscii(codePoint) && isLetter(codePoint);
}

function isPartCharacter(codePoint: number): boolean {
    return (
        isStartCharacter(codePoint) ||
        (isAscii(codePoint) && isDigit(codePoint))
    );
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

export function javaNameStyle(
    startWithUpper: boolean,
    upperUnderscore: boolean,
    original: string,
    acronymsStyle: (s: string) => string = allUpperWordStyle,
): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        upperUnderscore
            ? allUpperWordStyle
            : startWithUpper
              ? firstUpperWordStyle
              : allLowerWordStyle,
        upperUnderscore ? allUpperWordStyle : firstUpperWordStyle,
        upperUnderscore || startWithUpper
            ? allUpperWordStyle
            : allLowerWordStyle,
        // For UPPER_UNDERSCORE style (Java enum constants), always use allUpperWordStyle for acronyms
        // to maintain consistency with the naming convention (e.g., XXX_SPA_XXX)
        upperUnderscore ? allUpperWordStyle : acronymsStyle,
        upperUnderscore ? "_" : "",
        isStartCharacter,
    );
}
