"use strict";

import { Collection, List } from "immutable";

const unicode = require("unicode-properties");

// FIXME: This is a copy of code in src/Data/String/Util.js
export function stringConcatMap(mapper: (char: string) => string): (s: string) => string {
    const charStringMap: string[] = [];
    const charNoEscapeMap: number[] = [];

    for (let i = 0; i < 128; i++) {
        let noEscape = 0;
        const input = String.fromCharCode(i);
        const result = mapper(input);
        if (result === input) {
            noEscape = 1;
        }
        charStringMap.push(result);
        charNoEscapeMap.push(noEscape);
    }

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
                    cs.push(mapper(s.charAt(i)));
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

export function legalizeCharacters(isLegal: (c: string) => boolean): (s: string) => string {
    return stringConcatMap(c => (isLegal(c) ? c : "_"));
}

function intToHex(i: number, width: number): string {
    let str = i.toString(16);
    if (str.length >= width) return str;
    return "0".repeat(width - str.length) + str;
}

export function standardUnicodeHexEscape(c: string): string {
    const i = c.charCodeAt(0);
    if (i <= 0xffff) {
        return "\\u" + intToHex(i, 4);
    } else {
        return "\\U" + intToHex(i, 8);
    }
}

function genericStringEscape(escaper: (c: string) => string): (s: string) => string {
    function mapper(c: string): string {
        switch (c) {
            case "\\":
                return "\\\\";
            case '"':
                return '\\"';
            case "\n":
                return "\\n";
            case "\t":
                return "\\t";
            default:
                if (isPrintable(c)) {
                    return c;
                }
                return escaper(c);
        }
    }
    return stringConcatMap(mapper);
}

export const stringEscape = genericStringEscape(standardUnicodeHexEscape);

function isPrintable(c: string): boolean {
    const category = unicode.getCategory(c.charCodeAt(0));
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

export function isLetter(c: string): boolean {
    const category = unicode.getCategory(c.charCodeAt(0));
    // FIXME: Include Letter, modifier (Lm)?
    return ["Lu", "Ll", "Lt", "Lo"].indexOf(category) >= 0;
}

export function isDigit(c: string): boolean {
    const category = unicode.getCategory(c.charCodeAt(0));
    return ["Nd"].indexOf(category) >= 0;
}

export function isLetterOrUnderscore(c: string): boolean {
    return isLetter(c) || c == "_";
}

export function isLetterOrUnderscoreOrDigit(c: string): boolean {
    return isLetter(c) || isDigit(c) || c == "_";
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

const wordSeparatorRegex = RegExp("[-_. ]");

export function camelCase(str: string): string {
    const words = str.split(wordSeparatorRegex).map(capitalize);
    return words.join("");
}

export function startWithLetter(
    isLetter: (c: string) => boolean,
    upper: boolean,
    str: string
): string {
    const modify = upper ? capitalize : decapitalize;
    if (str === "") return modify("empty");
    if (isLetter(str[0])) return modify(str);
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
