import { type Name, funPrefixNamer } from "../../Naming.js";
import type { Type } from "../../Type/index.js";
import {
    allLowerWordStyle,
    allUpperWordStyle,
    combineWords,
    firstUpperWordStyle,
    isDigit,
    isLetterOrUnderscore,
    isNumeric,
    legalizeCharacters,
    splitIntoWords,
} from "../../support/Strings.js";

import {
    forbiddenPropertyNames,
    invalidSymbols,
    keywords,
} from "./constants.js";

/**
 * Check if given parameter name should be wrapped in a backtick
 * @param paramName
 */
export const shouldAddBacktick = (paramName: string): boolean => {
    return (
        keywords.some((s) => paramName === s) ||
        invalidSymbols.some((s) => paramName.includes(s)) ||
        !Number.isNaN(+Number.parseFloat(paramName)) ||
        !Number.isNaN(Number.parseInt(paramName.charAt(0), 10))
    );
};

/**
 * Wrap a name in backticks if it isn't usable as a plain Scala identifier.
 */
export const backtickedName = (name: string): string => {
    return name.endsWith("_") || name.includes(" ") || shouldAddBacktick(name)
        ? `\`${name}\``
        : name;
};

export const propertyNameNeedsMapping = (jsonName: string): boolean => {
    const isPlainIdentifier = /^[\p{L}_$][\p{L}\p{M}\p{N}_$]*$/u.test(jsonName);
    const rendered = backtickedName(jsonName);
    const canBeBackticked =
        rendered.startsWith("`") &&
        rendered.endsWith("`") &&
        !Array.from(jsonName).some((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return (
                character === "`" ||
                character === "\\" ||
                codePoint <= 0x1f ||
                (codePoint >= 0x7f && codePoint <= 0x9f) ||
                codePoint === 0x2028 ||
                codePoint === 0x2029
            );
        });

    return (
        jsonName === "_" ||
        (!isPlainIdentifier && !canBeBackticked) ||
        forbiddenPropertyNames.some((name) => name === jsonName)
    );
};

export const wrapOption = (s: string, optional: boolean): string => {
    if (optional) {
        return `Option[${s}]`;
    } else {
        return s;
    }
};

/**
 * Sort order for union members when emitting the decoders of an untagged
 * union, which try each member in turn: both circe's and upickle's
 * primitive number/boolean decoders are lenient (they accept strings like
 * "5"), and a case class whose fields are all defaulted can spuriously
 * read non-object JSON with upickle, so try the most discriminating
 * decoders first -- enums (which accept only their known strings), then
 * strings, then the other primitives, classes last.
 */
export const unionMemberSortOrder = (_: Name, t: Type): string => {
    const priority: Partial<Record<Type["kind"], string>> = {
        enum: "0",
        string: "2",
        bool: "3",
        integer: "4",
        double: "5",
        array: "6",
        map: "7",
        class: "9",
    };
    return `${priority[t.kind] ?? "8"}${t.kind}`;
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
        isStartCharacter,
    );
}

/**
 * Style an enum case as a legal Scala identifier. The JSON string an enum
 * case comes from can be anything (a keyword, `"_"`, `""`, …), so the
 * renderers emit styled case names and map them back to the original JSON
 * strings in their codecs.
 */
export function enumCaseNameStyle(original: string): string {
    const styled = scalaNameStyle(true, original);
    // `scalaNameStyle` can produce the empty string, for example for `""`
    // or `"_"` (which is not a legal identifier even in backticks). The
    // namer disambiguates if an enum has several such cases.
    return styled === "" ? "Empty" : styled;
}

export const upperNamingFunction = funPrefixNamer("upper", (s) =>
    scalaNameStyle(true, s),
);
export const lowerNamingFunction = funPrefixNamer("lower", (s) => {
    const styled = scalaNameStyle(false, s);
    // uPickle's Scala 3 derivation can generate a synthetic accessor with
    // the same name as fields that consist only of an underscore and digits.
    if (styled === "") return "field";
    if (/^_\d+$/.test(styled)) return `field${styled.slice(1)}`;
    if (forbiddenPropertyNames.some((name) => name === styled)) {
        return `${styled}Value`;
    }
    return styled;
});
