"use strict";

// FIXME: This is a copy of code in src/Data/String/Util.js
export function stringConcatMap(
    mapper: (char: string) => string
): (s: string) => string {
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

export function legalizeCharacters(
    isLegal: (c: string) => boolean
): (s: string) => string {
    return stringConcatMap(c => (isLegal(c) ? c : "_"));
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
