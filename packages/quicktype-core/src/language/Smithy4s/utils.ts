import { funPrefixNamer } from "../../Naming";
import {
    isLetterOrUnderscore,
    isNumeric,
    legalizeCharacters,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allLowerWordStyle,
    allUpperWordStyle
} from "../../support/Strings";
import { isDigit } from "unicode-properties";
import { keywords, invalidSymbols } from "./constants";

/**
 * Check if given parameter name should be wrapped in a backtick
 * @param paramName
 */
export const shouldAddBacktick = (paramName: string): boolean => {
    return (
        keywords.some(s => paramName === s) ||
        invalidSymbols.some(s => paramName.includes(s)) ||
        !isNaN(parseFloat(paramName)) ||
        !isNaN(parseInt(paramName.charAt(0)))
    );
};

function isPartCharacter(codePoint: number): boolean {
    return isLetterOrUnderscore(codePoint) || isNumeric(codePoint);
}

function isStartCharacter(codePoint: number): boolean {
    return isPartCharacter(codePoint) && !isDigit(codePoint);
}

const legalizeName = legalizeCharacters(isPartCharacter);

export function scalaNameStyle(isUpper: boolean, original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        isUpper ? firstUpperWordStyle : allLowerWordStyle,
        firstUpperWordStyle,
        isUpper ? allUpperWordStyle : allLowerWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
}

export const upperNamingFunction = funPrefixNamer("upper", s => scalaNameStyle(true, s));
export const lowerNamingFunction = funPrefixNamer("lower", s => scalaNameStyle(false, s));
