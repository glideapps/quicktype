import { DefaultDateTimeRecognizer } from "../../DateTime";
import { type Name } from "../../Naming";
import { type ForEachPosition } from "../../Renderer";
import {
    addPrefixIfNecessary,
    allLowerWordStyle,
    allUpperWordStyle,
    combineWords,
    escapeNonPrintableMapper,
    firstUpperWordStyle,
    intToHex,
    isDigit,
    isLetterOrUnderscore,
    isNumeric,
    isPrintable,
    legalizeCharacters,
    splitIntoWords,
    utf32ConcatMap
} from "../../support/Strings";
import { type ClassProperty } from "../../Type";

export const MAX_SAMELINE_PROPERTIES = 4;

// These are all recognized by Swift as ISO8601 date-times:
//
// 2018-08-14T02:45:50+00:00
// 2018-08-14T02:45:50+00
// 2018-08-14T02:45:50+1
// 2018-08-14T02:45:50+1111
// 2018-08-14T02:45:50+1111:1:33
// 2018-08-14T02:45:50-00
// 2018-08-14T02:45:50z
// 2018-00008-1T002:45:3Z

const swiftDateTimeRegex = /^\d+-\d+-\d+T\d+:\d+:\d+([zZ]|[+-]\d+(:\d+)?)$/;

export class SwiftDateTimeRecognizer extends DefaultDateTimeRecognizer {
    public isDateTime(str: string): boolean {
        return swiftDateTimeRegex.exec(str) !== null;
    }
}

export interface SwiftProperty {
    jsonName: string;
    name: Name;
    parameter: ClassProperty;
    position: ForEachPosition;
}

function isPartCharacter(codePoint: number): boolean {
    return isLetterOrUnderscore(codePoint) || isNumeric(codePoint);
}

function isStartCharacter(codePoint: number): boolean {
    return isPartCharacter(codePoint) && !isDigit(codePoint);
}

const legalizeName = legalizeCharacters(isPartCharacter);

export function swiftNameStyle(
    prefix: string,
    isUpper: boolean,
    original: string,
    acronymsStyle: (s: string) => string = allUpperWordStyle
): string {
    const words = splitIntoWords(original);
    const combined = combineWords(
        words,
        legalizeName,
        isUpper ? firstUpperWordStyle : allLowerWordStyle,
        firstUpperWordStyle,
        isUpper ? allUpperWordStyle : allLowerWordStyle,
        acronymsStyle,
        "",
        isStartCharacter
    );
    return addPrefixIfNecessary(prefix, combined);
}

function unicodeEscape(codePoint: number): string {
    return "\\u{" + intToHex(codePoint, 0) + "}";
}

export const stringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, unicodeEscape));
