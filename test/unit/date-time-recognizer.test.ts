// The default date/time recognizer decides whether a JSON string sample is
// inferred as "date", "time", or "date-time". It must accept only strict
// RFC 3339 forms: "date-time" requires the "T" (or "t") separator — a space
// is not allowed — and times must carry a timezone offset. Before this was
// tightened, strings like "2013-06-15 21:10:28" were inferred as date-times,
// producing generated code whose strict date parsers (Go, Swift, java.time,
// ...) could not read the very samples the types were inferred from.
import { DefaultDateTimeRecognizer } from "quicktype-core/dist/DateTime.js";
import { KotlinDateTimeRecognizer } from "quicktype-core/dist/language/Kotlin/utils.js";
import { describe, expect, test } from "vitest";

const recognizer = new DefaultDateTimeRecognizer();

describe("isDateTime", () => {
    test("accepts RFC 3339 date-times with offset", () => {
        expect(recognizer.isDateTime("2018-08-14T02:45:50Z")).toBe(true);
        expect(recognizer.isDateTime("2018-08-14T02:45:50+01:00")).toBe(true);
        expect(recognizer.isDateTime("2018-08-14T02:45:50-11:30")).toBe(true);
    });

    test("accepts lowercase t and z", () => {
        expect(recognizer.isDateTime("2018-08-14t02:45:50z")).toBe(true);
    });

    test("accepts fractional seconds", () => {
        expect(recognizer.isDateTime("2015-04-24T01:46:50.342496Z")).toBe(true);
        expect(recognizer.isDateTime("2010-01-12T00:00:00.000Z")).toBe(true);
        expect(recognizer.isDateTime("2015-07-15T23:25:21.541+02:00")).toBe(
            true,
        );
    });

    test("rejects a space separator", () => {
        expect(recognizer.isDateTime("2013-06-15 21:10:28")).toBe(false);
        expect(recognizer.isDateTime("1970-01-01 00:00:00")).toBe(false);
        expect(recognizer.isDateTime("2015-04-24 01:46:50.342496Z")).toBe(
            false,
        );
    });

    test("rejects a missing timezone offset", () => {
        expect(recognizer.isDateTime("2018-08-14T02:45:50")).toBe(false);
        expect(recognizer.isDateTime("2018-08-14T02:45:50.123")).toBe(false);
    });

    test("rejects invalid dates and times", () => {
        expect(recognizer.isDateTime("0000-00-00T00:00:00Z")).toBe(false);
        expect(recognizer.isDateTime("2018-13-01T00:00:00Z")).toBe(false);
        expect(recognizer.isDateTime("2018-08-14T24:00:00Z")).toBe(false);
        expect(recognizer.isDateTime("2018-08-14X02:45:50Z")).toBe(false);
    });
});

describe("isDate", () => {
    test("accepts RFC 3339 full-date", () => {
        expect(recognizer.isDate("2018-08-14")).toBe(true);
        expect(recognizer.isDate("1970-01-01")).toBe(true);
    });

    test("rejects invalid dates", () => {
        expect(recognizer.isDate("0000-00-00")).toBe(false);
        expect(recognizer.isDate("2018-13-01")).toBe(false);
        expect(recognizer.isDate("2018-02-30")).toBe(false);
        expect(recognizer.isDate("2018-8-14")).toBe(false);
    });
});

describe("isTime", () => {
    test("accepts RFC 3339 full-time (offset required)", () => {
        expect(recognizer.isTime("02:45:50Z")).toBe(true);
        expect(recognizer.isTime("02:45:50z")).toBe(true);
        expect(recognizer.isTime("02:45:50.123+01:00")).toBe(true);
        expect(recognizer.isTime("23:59:59-11:30")).toBe(true);
    });

    test("rejects a missing timezone offset", () => {
        expect(recognizer.isTime("02:45:50")).toBe(false);
        expect(recognizer.isTime("02:45:50.123")).toBe(false);
    });

    test("rejects invalid times", () => {
        expect(recognizer.isTime("24:00:00Z")).toBe(false);
        expect(recognizer.isTime("02:60:00Z")).toBe(false);
        expect(recognizer.isTime("02:45:60Z")).toBe(false);
    });
});

// The Kotlin recognizer additionally requires that java.time's ISO
// formatters (which the generated Kotlin code round-trips through)
// reproduce the string byte-identically. All rules below were verified
// against java.time's actual parse/format behavior.
describe("KotlinDateTimeRecognizer", () => {
    const kotlin = new KotlinDateTimeRecognizer();

    test("accepts date-times java.time round-trips identically", () => {
        expect(kotlin.isDateTime("2018-08-14T02:45:50Z")).toBe(true);
        expect(kotlin.isDateTime("2010-12-01T00:00:00Z")).toBe(true);
        expect(kotlin.isDateTime("2018-08-14T02:45:50+05:30")).toBe(true);
        expect(kotlin.isDateTime("2015-04-24T01:46:50.342496Z")).toBe(true);
        expect(kotlin.isDateTime("2018-08-14T02:45:50.5Z")).toBe(true);
        expect(kotlin.isDateTime("2018-08-14T02:45:50.123456789Z")).toBe(true);
        expect(kotlin.isDateTime("2016-02-29T00:00:00Z")).toBe(true);
    });

    test("rejects fractional seconds with trailing zeros", () => {
        // java.time formats the shortest fraction: ".000" disappears,
        // ".500" becomes ".5", ".828000" becomes ".828".
        expect(kotlin.isDateTime("2010-01-12T00:00:00.000Z")).toBe(false);
        expect(kotlin.isDateTime("2018-08-14T02:45:50.50Z")).toBe(false);
        expect(kotlin.isDateTime("2008-09-10T13:21:30.828000Z")).toBe(false);
        expect(kotlin.isDateTime("2015-04-24T02:04:02.997570Z")).toBe(false);
    });

    test("rejects fractions beyond nanosecond precision", () => {
        // java.time refuses to parse more than 9 fractional digits.
        expect(kotlin.isDateTime("2018-08-14T02:45:50.1234567891Z")).toBe(
            false,
        );
    });

    test("rejects zero offsets, which format back as Z", () => {
        expect(kotlin.isDateTime("2018-08-14T02:45:50+00:00")).toBe(false);
        expect(kotlin.isDateTime("2018-08-14T02:45:50-00:00")).toBe(false);
        expect(kotlin.isTime("10:30:00+00:00")).toBe(false);
    });

    test("rejects offsets outside java.time's ±18:00 range", () => {
        expect(kotlin.isDateTime("2018-08-14T02:45:50+18:00")).toBe(true);
        expect(kotlin.isDateTime("2018-08-14T02:45:50-18:00")).toBe(true);
        expect(kotlin.isDateTime("2018-08-14T02:45:50+18:01")).toBe(false);
        expect(kotlin.isDateTime("2018-08-14T02:45:50+19:00")).toBe(false);
    });

    test("rejects lowercase t and z, which format back in uppercase", () => {
        expect(kotlin.isDateTime("2018-08-14t02:45:50Z")).toBe(false);
        expect(kotlin.isDateTime("2018-08-14T02:45:50z")).toBe(false);
        expect(kotlin.isTime("02:45:50z")).toBe(false);
    });

    test("rejects Feb 29 outside leap years, which java.time cannot parse", () => {
        expect(kotlin.isDate("2016-02-29")).toBe(true);
        expect(kotlin.isDate("2000-02-29")).toBe(true);
        expect(kotlin.isDate("2015-02-29")).toBe(false);
        expect(kotlin.isDate("1900-02-29")).toBe(false);
        expect(kotlin.isDateTime("2015-02-29T00:00:00Z")).toBe(false);
    });

    test("accepts times java.time round-trips identically", () => {
        expect(kotlin.isTime("02:45:50Z")).toBe(true);
        expect(kotlin.isTime("23:20:50.52Z")).toBe(true);
        expect(kotlin.isTime("23:20:50.520Z")).toBe(false);
    });
});
