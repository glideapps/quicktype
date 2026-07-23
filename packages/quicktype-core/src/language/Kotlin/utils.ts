import { DefaultDateTimeRecognizer } from "../../DateTime.js";
import type { Type } from "../../Type/index.js";

import {
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
    utf32ConcatMap,
} from "../../support/Strings.js";

function isPartCharacter(codePoint: number): boolean {
    return isLetterOrUnderscore(codePoint) || isNumeric(codePoint);
}

function isStartCharacter(codePoint: number): boolean {
    return isPartCharacter(codePoint) && !isDigit(codePoint);
}

const legalizeName = legalizeCharacters(isPartCharacter);

export function kotlinNameStyle(
    isUpper: boolean,
    original: string,
    acronymsStyle: (s: string) => string = allUpperWordStyle,
): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        isUpper ? firstUpperWordStyle : allLowerWordStyle,
        firstUpperWordStyle,
        isUpper ? allUpperWordStyle : allLowerWordStyle,
        acronymsStyle,
        "",
        isStartCharacter,
    );
}

function unicodeEscape(codePoint: number): string {
    return `\\u${intToHex(codePoint, 4)}`;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const _stringEscape = utf32ConcatMap(
    escapeNonPrintableMapper(isPrintable, unicodeEscape),
);

export function stringEscape(s: string): string {
    // "$this" is a template string in Kotlin so we have to escape $
    return _stringEscape(s).replace(/\$/g, "\\$");
}

// The generated code round-trips date/time values through java.time's
// ISO_LOCAL_DATE / ISO_OFFSET_TIME / ISO_OFFSET_DATE_TIME, so we only
// recognize strings those formatters reproduce byte-identically (all
// verified against java.time):
//
// - Fractional seconds must not end in "0" — java.time formats the
//   shortest fraction (".500" becomes ".5", ".000" disappears) — and
//   have at most 9 digits, java.time's nanosecond precision.
// - The UTC offset must be "Z" or a nonzero "±hh:mm": zero offsets
//   format back as "Z", and java.time rejects offsets beyond ±18:00.
// - Lowercase "t"/"z" format back in uppercase.
// - February 29 only exists in leap years; java.time refuses to parse
//   it in other years (the default recognizer always allows it).
//
// Anything rejected here simply stays a plain string. This only affects
// inference from JSON samples — JSON Schema's "format": "date-time" is
// mapped regardless.
const KOTLIN_TIME = /^(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/;

function isLeapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export class KotlinDateTimeRecognizer extends DefaultDateTimeRecognizer {
    public isDate(str: string): boolean {
        if (!super.isDate(str)) return false;

        const [year, month, day] = str.split("-").map(Number);
        return month !== 2 || day !== 29 || isLeapYear(year);
    }

    public isTime(str: string): boolean {
        const matches = KOTLIN_TIME.exec(str);
        if (matches === null) return false;

        const hour = +matches[1];
        const minute = +matches[2];
        const second = +matches[3];
        if (hour > 23 || minute > 59 || second > 59) return false;

        const fraction = matches[4];
        if (fraction?.endsWith("0")) return false;

        const offset = matches[5];
        if (offset === "Z") return true;

        const offsetHour = +offset.slice(1, 3);
        const offsetMinute = +offset.slice(4, 6);
        if (offsetHour === 0 && offsetMinute === 0) return false;
        return offsetMinute <= 59 && offsetHour * 60 + offsetMinute <= 18 * 60;
    }

    public isDateTime(str: string): boolean {
        const dateTime = str.split("T");
        return (
            dateTime.length === 2 &&
            this.isDate(dateTime[0]) &&
            this.isTime(dateTime[1])
        );
    }
}

// When several union members are guarded by the same JSON node/value type
// (e.g. date, time and enum values are all strings), parse attempts must be
// ordered strictest first: transformed string types (strict ISO parsers),
// then enums (known values only), then plain strings (accept anything).
export function unionMemberMatchPriority(t: Type): number {
    if (t.kind === "date-time" || t.kind === "date" || t.kind === "time") {
        return 0;
    }

    if (t.kind === "enum") {
        return 1;
    }

    if (t.kind === "string") {
        return 2;
    }

    return 3;
}
