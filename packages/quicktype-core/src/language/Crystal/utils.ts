import { funPrefixNamer } from "../../Naming";
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
    utf32ConcatMap
} from "../../support/Strings";

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

function crystalStyle(original: string, isSnakeCase: boolean): string {
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
        isAsciiLetterOrUnderscore
    );

    return combined === "_" ? "_underscore" : combined;
}

export const snakeNamingFunction = funPrefixNamer("default", (original: string) => crystalStyle(original, true));
export const camelNamingFunction = funPrefixNamer("camel", (original: string) => crystalStyle(original, false));

function standardUnicodeCrystalEscape(codePoint: number): string {
    if (codePoint <= 0xffff) {
        return "\\u{" + intToHex(codePoint, 4) + "}";
    } else {
        return "\\u{" + intToHex(codePoint, 6) + "}";
    }
}

export const crystalStringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, standardUnicodeCrystalEscape));
