"use strict";

import { Collection, List } from "immutable";

const unicode = require("unicode-properties");

function computeAsciiMap(
    mapper: (codePoint: number) => string
): { charStringMap: string[]; charNoEscapeMap: number[] } {
    const charStringMap: string[] = [];
    const charNoEscapeMap: number[] = [];

    for (let i = 0; i < 128; i++) {
        let noEscape = 0;
        const result = mapper(i);
        if (result === String.fromCharCode(i)) {
            noEscape = 1;
        }
        charStringMap.push(result);
        charNoEscapeMap.push(noEscape);
    }

    return { charStringMap, charNoEscapeMap };
}

// FIXME: This is a copy of code in src/Data/String/Util.js
export function utf16ConcatMap(mapper: (utf16Unit: number) => string): (s: string) => string {
    const { charStringMap, charNoEscapeMap } = computeAsciiMap(mapper);

    return function stringConcatMap_inner(s: string): string {
        let cs: string[] | null = null;
        let start = 0;
        let i = 0;
        while (i < s.length) {
            var cc = s.charCodeAt(i);
            if (!charNoEscapeMap[cc]) {
                if (cs === null) cs = [];
                cs.push(s.substring(start, i));

                const str = charStringMap[cc];
                if (str === undefined) {
                    cs.push(mapper(s.charCodeAt(i)));
                } else {
                    cs.push(str);
                }

                start = i + 1;
            }
            i++;
        }

        if (cs === null) return s;

        cs.push(s.substring(start, i));

        return cs.join("");
    };
}

export function utf32ConcatMap(mapper: (codePoint: number) => string): (s: string) => string {
    const { charStringMap, charNoEscapeMap } = computeAsciiMap(mapper);

    return function stringConcatMap_inner(s: string): string {
        let cs: string[] | null = null;
        let start = 0;
        let i = 0;
        while (i < s.length) {
            var cc = s.charCodeAt(i);
            if (!charNoEscapeMap[cc]) {
                if (cs === null) cs = [];
                cs.push(s.substring(start, i));

                if (cc >= 0xd800 && cc <= 0xdbff) {
                    const highSurrogate = cc;
                    i++;
                    const lowSurrogate = s.charCodeAt(i);
                    if (lowSurrogate < 0xdc00 || lowSurrogate > 0xdfff) {
                        throw "High surrogate not followed by low surrogate";
                    }
                    const highBits = highSurrogate - 0xd800;
                    const lowBits = lowSurrogate - 0xdc00;
                    cc = 0x10000 + lowBits + (highBits << 10);
                }

                const str = charStringMap[cc];
                if (str === undefined) {
                    cs.push(mapper(cc));
                } else {
                    cs.push(str);
                }

                start = i + 1;
            }
            i++;
        }

        if (cs === null) return s;

        cs.push(s.substring(start, i));

        return cs.join("");
    };
}

export function utf16LegalizeCharacters(isLegal: (utf16Unit: number) => boolean): (s: string) => string {
    return utf16ConcatMap(u => (isLegal(u) ? String.fromCharCode(u) : "_"));
}

export function legalizeCharacters(isLegal: (codePoint: number) => boolean): (s: string) => string {
    return utf32ConcatMap(u => (u <= 0xffff && isLegal(u) ? String.fromCharCode(u) : "_"));
}

export function intToHex(i: number, width: number): string {
    let str = i.toString(16);
    if (str.length >= width) return str;
    return "0".repeat(width - str.length) + str;
}

export function standardUnicodeHexEscape(codePoint: number): string {
    if (codePoint <= 0xffff) {
        return "\\u" + intToHex(codePoint, 4);
    } else {
        return "\\U" + intToHex(codePoint, 8);
    }
}

export function escapeNonPrintableMapper(
    printablePredicate: (codePoint: number) => boolean,
    escaper: (codePoint: number) => string
): (u: number) => string {
    function mapper(u: number): string {
        switch (u) {
            case 0x5c:
                return "\\\\";
            case 0x22:
                return '\\"';
            case 0x0a:
                return "\\n";
            case 0x09:
                return "\\t";
            default:
                if (printablePredicate(u)) {
                    return String.fromCharCode(u);
                }
                return escaper(u);
        }
    }
    return mapper;
}

export const utf16StringEscape = utf16ConcatMap(escapeNonPrintableMapper(isPrintable, standardUnicodeHexEscape));
export const stringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, standardUnicodeHexEscape));

export function isPrintable(codePoint: number): boolean {
    if (codePoint > 0xffff) return false;
    const category = unicode.getCategory(codePoint);
    return (
        [
            "Mc",
            "No",
            "Sk",
            "Me",
            "Nd",
            "Po",
            "Lt",
            "Pc",
            "Sm",
            "Zs",
            "Lu",
            "Pd",
            "So",
            "Pe",
            "Pf",
            "Ps",
            "Sc",
            "Ll",
            "Lm",
            "Pi",
            "Nl",
            "Mn",
            "Lo"
        ].indexOf(category) >= 0
    );
}

export function isAscii(codePoint: number): boolean {
    return codePoint < 128;
}

export function isLetter(codePoint: number): boolean {
    const category = unicode.getCategory(codePoint);
    // FIXME: Include Letter, modifier (Lm)?
    return ["Lu", "Ll", "Lt", "Lo"].indexOf(category) >= 0;
}

export function isDigit(codePoint: number): boolean {
    const category = unicode.getCategory(codePoint);
    return ["Nd"].indexOf(category) >= 0;
}

export function isNumeric(codePoint: number): boolean {
    const category = unicode.getCategory(codePoint);
    return ["No", "Nd", "Nl"].indexOf(category) >= 0;
}

export function isLetterOrUnderscore(codePoint: number): boolean {
    return isLetter(codePoint) || codePoint === 0x5f;
}

export function isLetterOrUnderscoreOrDigit(codePoint: number): boolean {
    return isLetterOrUnderscore(codePoint) || isDigit(codePoint);
}

function modifyFirstChar(f: (c: string) => string, s: string): string {
    if (s === "") return s;
    return f(s[0]) + s.slice(1);
}

export function capitalize(str: string): string {
    return modifyFirstChar(c => c.toUpperCase(), str);
}

export function decapitalize(str: string): string {
    return modifyFirstChar(c => c.toLowerCase(), str);
}

const wordSeparatorRegex = /[-_. ]+/;

export function pascalCase(str: string): string {
    const words = str.split(wordSeparatorRegex).map(capitalize);
    return words.join("");
}

export function camelCase(str: string): string {
    return decapitalize(pascalCase(str));
}

export function snakeCase(str: string): string {
    const separated = str.replace(/([^A-Z])([A-Z])/g, "$1_$2");
    const words = separated.split(wordSeparatorRegex).map(decapitalize);
    return words.join("_");
}

export function upperUnderscoreCase(str: string): string {
    const separated = str.replace(/([^A-Z])([A-Z])/g, "$1_$2");
    const words = separated.split(wordSeparatorRegex).map(s => s.toUpperCase());
    return words.join("_");
}

export function startWithLetter(
    isAllowedStart: (codePoint: number) => boolean, // FIXME: technically, this operates on UTF16 units
    upper: boolean,
    str: string
): string {
    const modify = upper ? capitalize : decapitalize;
    if (str === "") return modify("empty");
    if (isAllowedStart(str.charCodeAt(0))) return modify(str);
    return modify("the" + str);
}

export function intercalate<T>(separator: T, items: Collection<any, T>): List<T> {
    const acc: T[] = [];
    items.forEach((x: T) => {
        if (acc.length > 0) acc.push(separator);
        acc.push(x);
    });
    return List(acc);
}

export function defined<T>(x: T | undefined): T {
    if (x !== undefined) return x;
    throw "Defined value expected, but got undefined";
}

export function nonNull<T>(x: T | null): T {
    if (x !== null) return x;
    throw "Non-null value expected, but got null";
}

export function assertNever(x: never): never {
    throw new Error("Unexpected object: " + x);
}
