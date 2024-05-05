import { funPrefixNamer } from "../../Naming";
import {
    allLowerWordStyle,
    combineWords,
    escapeNonPrintableMapper,
    firstUpperWordStyle,
    intToHex,
    isAscii,
    isLetterOrUnderscore,
    isLetterOrUnderscoreOrDigit,
    isPrintable,
    legalizeCharacters,
    splitIntoWords,
    utf32ConcatMap
} from "../../support/Strings";

type NameToParts = (name: string) => string[];
type PartsToName = (parts: string[]) => string;
interface NamingStyle {
    fromParts: PartsToName;
    regex: RegExp;
    toParts: NameToParts;
}

export const namingStyles: Record<string, NamingStyle> = {
    snake_case: {
        regex: /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/,
        toParts: (name: string): string[] => name.split("_"),
        fromParts: (parts: string[]): string => parts.map(p => p.toLowerCase()).join("_")
    },
    SCREAMING_SNAKE_CASE: {
        regex: /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/,
        toParts: (name: string): string[] => name.split("_"),
        fromParts: (parts: string[]): string => parts.map(p => p.toUpperCase()).join("_")
    },
    camelCase: {
        regex: /^[a-z]+([A-Z0-9][a-z]*)*$/,
        toParts: (name: string): string[] => namingStyles.snake_case.toParts(name.replace(/(.)([A-Z])/g, "$1_$2")),
        fromParts: (parts: string[]): string =>
            parts
                .map((p, i) =>
                    i === 0 ? p.toLowerCase() : p.substring(0, 1).toUpperCase() + p.substring(1).toLowerCase()
                )
                .join("")
    },
    PascalCase: {
        regex: /^[A-Z][a-z]*([A-Z0-9][a-z]*)*$/,
        toParts: (name: string): string[] => namingStyles.snake_case.toParts(name.replace(/(.)([A-Z])/g, "$1_$2")),
        fromParts: (parts: string[]): string =>
            parts.map(p => p.substring(0, 1).toUpperCase() + p.substring(1).toLowerCase()).join("")
    },
    "kebab-case": {
        regex: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
        toParts: (name: string): string[] => name.split("-"),
        fromParts: (parts: string[]): string => parts.map(p => p.toLowerCase()).join("-")
    },
    "SCREAMING-KEBAB-CASE": {
        regex: /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/,
        toParts: (name: string): string[] => name.split("-"),
        fromParts: (parts: string[]): string => parts.map(p => p.toUpperCase()).join("-")
    },
    lowercase: {
        regex: /^[a-z][a-z0-9]*$/,
        toParts: (name: string): string[] => [name],
        fromParts: (parts: string[]): string => parts.map(p => p.toLowerCase()).join("")
    },
    UPPERCASE: {
        regex: /^[A-Z][A-Z0-9]*$/,
        toParts: (name: string): string[] => [name],
        fromParts: (parts: string[]): string => parts.map(p => p.toUpperCase()).join("")
    }
};

const isAsciiLetterOrUnderscoreOrDigit = (codePoint: number): boolean => {
    if (!isAscii(codePoint)) {
        return false;
    }

    return isLetterOrUnderscoreOrDigit(codePoint);
};

const isAsciiLetterOrUnderscore = (codePoint: number): boolean => {
    if (!isAscii(codePoint)) {
        return false;
    }

    return isLetterOrUnderscore(codePoint);
};

const legalizeName = legalizeCharacters(isAsciiLetterOrUnderscoreOrDigit);

function rustStyle(original: string, isSnakeCase: boolean): string {
    const words = splitIntoWords(original);

    const wordStyle = isSnakeCase ? allLowerWordStyle : firstUpperWordStyle;

    const combined = combineWords(
        words,
        legalizeName,
        wordStyle,
        wordStyle,
        wordStyle,
        wordStyle,
        isSnakeCase ? "_" : "",
        isAsciiLetterOrUnderscore
    );

    return combined === "_" ? "_underscore" : combined;
}

export const snakeNamingFunction = funPrefixNamer("default", (original: string) => rustStyle(original, true));
export const camelNamingFunction = funPrefixNamer("camel", (original: string) => rustStyle(original, false));

const standardUnicodeRustEscape = (codePoint: number): string => {
    if (codePoint <= 0xffff) {
        return "\\u{" + intToHex(codePoint, 4) + "}";
    } else {
        return "\\u{" + intToHex(codePoint, 6) + "}";
    }
};

export const rustStringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, standardUnicodeRustEscape));

export function getPreferedNamingStyle(namingStyleOccurences: string[], defaultStyle: string): string {
    const occurrences = Object.fromEntries(Object.keys(namingStyles).map(key => [key, 0]));
    namingStyleOccurences.forEach(style => ++occurrences[style]);
    const max = Math.max(...Object.values(occurrences));
    const preferedStyles = Object.entries(occurrences)
        .filter(([_style, num]) => num === max)
        .map(([style, _num]) => style);
    if (preferedStyles.includes(defaultStyle)) {
        return defaultStyle;
    }

    return preferedStyles[0];
}

export function listMatchingNamingStyles(name: string): string[] {
    return Object.entries(namingStyles)
        .filter(([_, { regex }]) => regex.test(name))
        .map(([namingStyle, _]) => namingStyle);
}

export function nameToNamingStyle(name: string, style: string): string {
    if (namingStyles[style].regex.test(name)) {
        return name;
    }

    const fromStyle = listMatchingNamingStyles(name)[0];
    if (fromStyle === undefined) {
        return name;
    }

    return namingStyles[style].fromParts(namingStyles[fromStyle].toParts(name));
}
