import {
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allUpperWordStyle,
    allLowerWordStyle,
    utf16LegalizeCharacters,
    addPrefixIfNecessary
} from "../../support/Strings";

import unicode from "unicode-properties";
import { booleanPrefixes, forbiddenPropertyNames } from "./constants";

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
        } else if (!words[0].isAcronym && booleanPrefixes.indexOf(words[0].word) < 0) {
            words = [{ word: "is", isAcronym: false }, ...words];
        }
    }

    // Properties cannot even begin with any of the forbidden names
    // For example, properies named new* are treated differently by ARC
    // @ts-expect-error needs strict type
    if (words.length > 0 && forbiddenPropertyNames.indexOf(words[0].word) >= 0) {
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
    return ["Nd", "Pc", "Mn", "Mc"].indexOf(category) >= 0 || isStartCharacter(utf16Unit);
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

export const staticEnumValuesIdentifier = "values";
export const forbiddenForEnumCases = ["new", staticEnumValuesIdentifier];

export function splitExtension(filename: string): [string, string] {
    const i = filename.lastIndexOf(".");
    const extension = i !== -1 ? filename.split(".").pop() : "m";
    filename = i !== -1 ? filename.slice(0, i) : filename;
    return [filename, extension === undefined ? "m" : extension];
}
