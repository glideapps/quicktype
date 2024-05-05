import unicode from "unicode-properties";

import { minMaxLengthForType, minMaxValueForType } from "../../attributes/Constraints";
import { funPrefixNamer } from "../../Naming";
import { type Sourcelike } from "../../Source";
import {
    type WordInName,
    combineWords,
    firstUpperWordStyle,
    splitIntoWords,
    utf16LegalizeCharacters
} from "../../support/Strings";
import { panic } from "../../support/Support";
import { type Transformation } from "../../Transformers";
import { ArrayType, EnumType, type PrimitiveType, type Type, UnionType } from "../../Type";
import { nullableFromUnion } from "../../TypeUtils";

import { keywords } from "./constants";

export function noFollow(t: Type): Type {
    return t;
}

export function needTransformerForType(t: Type): "automatic" | "manual" | "nullable" | "none" {
    if (t instanceof UnionType) {
        const maybeNullable = nullableFromUnion(t);
        if (maybeNullable === null) return "automatic";
        if (needTransformerForType(maybeNullable) === "manual") return "nullable";
        return "none";
    }

    if (t instanceof ArrayType) {
        const itemsNeed = needTransformerForType(t.items);
        if (itemsNeed === "manual" || itemsNeed === "nullable") return "automatic";
        return "none";
    }

    if (t instanceof EnumType) return "automatic";
    if (t.kind === "double") return minMaxValueForType(t) !== undefined ? "manual" : "none";
    if (t.kind === "integer-string" || t.kind === "bool-string") return "manual";
    if (t.kind === "string") {
        return minMaxLengthForType(t) !== undefined ? "manual" : "none";
    }

    return "none";
}

export function alwaysApplyTransformation(xf: Transformation): boolean {
    const t = xf.targetType;
    if (t instanceof EnumType) return true;
    if (t instanceof UnionType) return nullableFromUnion(t) === null;
    return false;
}

/**
 * The C# type for a given transformed string type.
 */
export function csTypeForTransformedStringType(t: PrimitiveType): Sourcelike {
    switch (t.kind) {
        case "date-time":
            return "DateTimeOffset";
        case "uuid":
            return "Guid";
        case "uri":
            return "Uri";
        default:
            return panic(`Transformed string type ${t.kind} not supported`);
    }
}

export const namingFunction = funPrefixNamer("namer", csNameStyle);
export const namingFunctionKeep = funPrefixNamer("namerKeep", csNameStyleKeep);

// FIXME: Make a Named?
export const denseJsonPropertyName = "J";
export const denseRequiredEnumName = "R";
export const denseNullValueHandlingEnumName = "N";

export function isStartCharacter(utf16Unit: number): boolean {
    if (unicode.isAlphabetic(utf16Unit)) {
        return true;
    }

    return utf16Unit === 0x5f; // underscore
}

function isPartCharacter(utf16Unit: number): boolean {
    const category: string = unicode.getCategory(utf16Unit);
    if (["Nd", "Pc", "Mn", "Mc"].includes(category)) {
        return true;
    }

    return isStartCharacter(utf16Unit);
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

export function csNameStyle(original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        firstUpperWordStyle,
        firstUpperWordStyle,
        firstUpperWordStyle,
        firstUpperWordStyle,
        "",
        isStartCharacter
    );
}

function csNameStyleKeep(original: string): string {
    const words: WordInName[] = [
        {
            word: original,
            isAcronym: false
        }
    ];

    const result = combineWords(
        words,
        legalizeName,
        x => x,
        x => x,
        x => x,
        x => x,
        "",
        isStartCharacter
    );

    // @ts-expect-error needs strong type
    return keywords.includes(result) ? "@" + result : result;
}

export function isValueType(t: Type): boolean {
    if (t instanceof UnionType) {
        return nullableFromUnion(t) === null;
    }

    return ["integer", "double", "bool", "enum", "date-time", "uuid"].includes(t.kind);
}
