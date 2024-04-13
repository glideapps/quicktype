import { UnionType, ClassProperty } from "../../Type";
import { nullableFromUnion } from "../../TypeUtils";
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

function elmNameStyle(original: string, upper: boolean): string {
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

export const upperNamingFunction = funPrefixNamer("upper", n => elmNameStyle(n, true));
export const lowerNamingFunction = funPrefixNamer("lower", n => elmNameStyle(n, false));

type RequiredOrOptional = {
    reqOrOpt: string;
    fallback: string;
};

export function requiredOrOptional(p: ClassProperty): RequiredOrOptional {
    function optional(fallback: string): RequiredOrOptional {
        return { reqOrOpt: "Jpipe.optional", fallback };
    }
    const t = p.type;
    if (p.isOptional || (t instanceof UnionType && nullableFromUnion(t) !== null)) {
        return optional(" Nothing");
    }
    if (t.kind === "null") {
        return optional(" ()");
    }
    return { reqOrOpt: "Jpipe.required", fallback: "" };
}
