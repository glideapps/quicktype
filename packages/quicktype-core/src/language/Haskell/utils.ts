import { funPrefixNamer } from "../../Naming";
import {
    legalizeCharacters,
    isLetterOrUnderscoreOrDigit,
    isLetterOrUnderscore,
    isAscii,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allLowerWordStyle,
    allUpperWordStyle
} from "../../support/Strings";

const legalizeName = legalizeCharacters(cp => isAscii(cp) && isLetterOrUnderscoreOrDigit(cp));

function haskellNameStyle(original: string, upper: boolean): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        upper ? firstUpperWordStyle : allLowerWordStyle,
        firstUpperWordStyle,
        upper ? allUpperWordStyle : allLowerWordStyle,
        allUpperWordStyle,
        "",
        isLetterOrUnderscore
    );
}

export const upperNamingFunction = funPrefixNamer("upper", n => haskellNameStyle(n, true));
export const lowerNamingFunction = funPrefixNamer("lower", n => haskellNameStyle(n, false));
