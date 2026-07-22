import { funPrefixNamer } from "../../Naming.js";
import {
    allUpperWordStyle,
    combineWords,
    firstUpperWordStyle,
    isLetterOrUnderscore,
    isLetterOrUnderscoreOrDigit,
    legalizeCharacters,
    splitIntoWords,
} from "../../support/Strings.js";
import type { ClassProperty, Type, TypeKind } from "../../Type/index.js";

export const namingFunction = funPrefixNamer("namer", goNameStyle);

const legalizeName = legalizeCharacters(isLetterOrUnderscoreOrDigit);

function goNameStyle(original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        firstUpperWordStyle,
        firstUpperWordStyle,
        allUpperWordStyle,
        allUpperWordStyle,
        "",
        isLetterOrUnderscore,
    );
}

export const primitiveValueTypeKinds: TypeKind[] = [
    "integer",
    "double",
    "bool",
    "string",
];
export const compoundTypeKinds: TypeKind[] = ["array", "class", "map", "enum"];

export function isValueType(t: Type): boolean {
    const kind = t.kind;
    return (
        primitiveValueTypeKinds.includes(kind) ||
        kind === "class" ||
        kind === "enum" ||
        kind === "date-time"
    );
}

export function canOmitEmpty(
    cp: ClassProperty,
    omitEmptyOption: boolean,
): boolean {
    if (!cp.isOptional) return false;
    if (omitEmptyOption)
        return !["union", "null", "any"].includes(cp.type.kind);
    const t = cp.type;
    return !["union", "null", "any"].includes(t.kind);
}
