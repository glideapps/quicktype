import unicode from "unicode-properties";

import {
    allLowerWordStyle,
    allUpperWordStyle,
    combineWords,
    firstUpperWordStyle,
    originalWord,
    splitIntoWords,
    utf16LegalizeCharacters
} from "../../support/Strings";

function isNormalizedStartCharacter3(utf16Unit: number): boolean {
    // FIXME: add Other_ID_Start - https://docs.python.org/3/reference/lexical_analysis.html#identifiers
    const category: string = unicode.getCategory(utf16Unit);
    return ["Lu", "Ll", "Lt", "Lm", "Lo", "Nl"].includes(category);
}

function isNormalizedPartCharacter3(utf16Unit: number): boolean {
    // FIXME: add Other_ID_Continue - https://docs.python.org/3/reference/lexical_analysis.html#identifiers
    if (isNormalizedStartCharacter3(utf16Unit)) return true;
    const category: string = unicode.getCategory(utf16Unit);
    return ["Mn", "Mc", "Nd", "Pc"].includes(category);
}

function isStartCharacter3(utf16Unit: number): boolean {
    const s = String.fromCharCode(utf16Unit).normalize("NFKC");
    const l = s.length;
    if (l === 0 || !isNormalizedStartCharacter3(s.charCodeAt(0))) return false;
    for (let i = 1; i < l; i++) {
        if (!isNormalizedPartCharacter3(s.charCodeAt(i))) return false;
    }

    return true;
}

function isPartCharacter3(utf16Unit: number): boolean {
    const s = String.fromCharCode(utf16Unit).normalize("NFKC");
    const l = s.length;
    for (let i = 0; i < l; i++) {
        if (!isNormalizedPartCharacter3(s.charCodeAt(i))) return false;
    }

    return true;
}

const legalizeName3 = utf16LegalizeCharacters(isPartCharacter3);

export function classNameStyle(original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName3,
        firstUpperWordStyle,
        firstUpperWordStyle,
        allUpperWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter3
    );
}

function getWordStyle(uppercase: boolean, forceSnakeNameStyle: boolean) {
    if (!forceSnakeNameStyle) {
        return originalWord;
    }

    return uppercase ? allUpperWordStyle : allLowerWordStyle;
}

export function snakeNameStyle(original: string, uppercase: boolean, forceSnakeNameStyle: boolean): string {
    const wordStyle = getWordStyle(uppercase, forceSnakeNameStyle);
    const separator = forceSnakeNameStyle ? "_" : "";
    const words = splitIntoWords(original);
    return combineWords(words, legalizeName3, wordStyle, wordStyle, wordStyle, wordStyle, separator, isStartCharacter3);
}
