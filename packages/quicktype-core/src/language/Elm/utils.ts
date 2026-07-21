import { funPrefixNamer } from "../../Naming.js";
import {
    allLowerWordStyle,
    allUpperWordStyle,
    combineWords,
    escapeNonPrintableMapper,
    firstUpperWordStyle,
    intToHex,
    isAscii,
    isLetter,
    isLetterOrUnderscoreOrDigit,
    isPrintable,
    legalizeCharacters,
    splitIntoWords,
    utf32ConcatMap,
} from "../../support/Strings.js";
import { type ClassProperty, UnionType } from "../../Type/index.js";
import { nullableFromUnion } from "../../Type/TypeUtils.js";

const legalizeName = legalizeCharacters(
    (cp) => isAscii(cp) && isLetterOrUnderscoreOrDigit(cp),
);

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
        // Elm identifiers must not start with an underscore.
        isLetter,
    );
}

function unicodeEscape(codePoint: number): string {
    return `\\u{${intToHex(codePoint, 4).toUpperCase()}}`;
}

export const elmStringEscape = utf32ConcatMap(
    escapeNonPrintableMapper(isPrintable, unicodeEscape),
);

export const upperNamingFunction = funPrefixNamer("upper", (n) =>
    elmNameStyle(n, true),
);
export const lowerNamingFunction = funPrefixNamer("lower", (n) =>
    elmNameStyle(n, false),
);

interface RequiredOrOptional {
    fallback: string;
    reqOrOpt: string;
}

export function requiredOrOptional(p: ClassProperty): RequiredOrOptional {
    function optional(fallback: string): RequiredOrOptional {
        return { reqOrOpt: "Jpipe.optional", fallback };
    }

    const t = p.type;
    if (
        p.isOptional ||
        (t instanceof UnionType && nullableFromUnion(t) !== null)
    ) {
        return optional(" Nothing");
    }

    if (t.kind === "null") {
        return optional(" ()");
    }

    return { reqOrOpt: "Jpipe.required", fallback: "" };
}
