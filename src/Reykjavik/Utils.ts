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
