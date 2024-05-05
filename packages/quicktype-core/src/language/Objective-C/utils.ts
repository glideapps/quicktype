import unicode from "unicode-properties";

import {
    addPrefixIfNecessary,
    allLowerWordStyle,
    allUpperWordStyle,
    combineWords,
    firstUpperWordStyle,
    splitIntoWords,
    utf16LegalizeCharacters
} from "../../support/Strings";

import { booleanPrefixes, forbiddenPropertyNames } from "./constants";

export const DEFAULT_CLASS_PREFIX = "QT";

export function typeNameStyle(prefix: string, original: string): string {
    const words = splitIntoWords(original);
    const result = combineWords(
        words,
        legalizeName,
        firstUpperWordStyle,
        firstUpperWordStyle,
        allUpperWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
    return addPrefixIfNecessary(prefix, result);
}

export function propertyNameStyle(original: string, isBool = false): string {
    // Objective-C developers are uncomfortable with property "id"
    // so we use an alternate name in this special case.
    if (original === "id") {
        original = "identifier";
    }

    let words = splitIntoWords(original);

    if (isBool) {
        if (words.length === 0) {
            words = [{ word: "flag", isAcronym: false }];
            // @ts-expect-error needs strict type
        } else if (!words[0].isAcronym && !booleanPrefixes.includes(words[0].word)) {
            words = [{ word: "is", isAcronym: false }, ...words];
        }
    }

    // Properties cannot even begin with any of the forbidden names
    // For example, properies named new* are treated differently by ARC
    // @ts-expect-error needs strict type
    if (words.length > 0 && forbiddenPropertyNames.includes(words[0].word)) {
        words = [{ word: "the", isAcronym: false }, ...words];
    }

    return combineWords(
        words,
        legalizeName,
        allLowerWordStyle,
        firstUpperWordStyle,
        allLowerWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
}

function isStartCharacter(utf16Unit: number): boolean {
    return unicode.isAlphabetic(utf16Unit) || utf16Unit === 0x5f; // underscore
}

function isPartCharacter(utf16Unit: number): boolean {
    const category: string = unicode.getCategory(utf16Unit);
    return ["Nd", "Pc", "Mn", "Mc"].includes(category) || isStartCharacter(utf16Unit);
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

export const staticEnumValuesIdentifier = "values";
export const forbiddenForEnumCases = ["new", staticEnumValuesIdentifier];

export function splitExtension(filename: string): [string, string] {
    const i = filename.lastIndexOf(".");
    const extension = i !== -1 ? filename.split(".").pop() : "m";
    filename = i !== -1 ? filename.slice(0, i) : filename;
    return [filename, extension ?? "m"];
}
