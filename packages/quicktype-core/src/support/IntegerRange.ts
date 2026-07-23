/**
 * An inclusive range of integers that a target language's integer type can
 * represent exactly.  The bounds are decimal strings because they can lie
 * outside the range in which JavaScript numbers are exact — the int64
 * boundaries, for example, are not representable as doubles.
 */
export interface IntegerRange {
    readonly max: string;
    readonly min: string;
}

/**
 * The range of a signed 64-bit integer, the integer type that most of
 * quicktype's target languages use.
 */
export const INT64_RANGE: IntegerRange = {
    min: "-9223372036854775808",
    max: "9223372036854775807",
};

/**
 * The ranges of the narrower fixed-size signed integer types, for target
 * languages whose integer type is less than 64 bits wide.
 */
export const INT32_RANGE: IntegerRange = {
    min: "-2147483648",
    max: "2147483647",
};

export const INT16_RANGE: IntegerRange = {
    min: "-32768",
    max: "32767",
};

export const INT8_RANGE: IntegerRange = {
    min: "-128",
    max: "127",
};

/**
 * The range in which every integer is exactly representable as an IEEE-754
 * double, which is how JavaScript and its relatives represent all numbers.
 */
export const JS_SAFE_INTEGER_RANGE: IntegerRange = {
    min: "-9007199254740991",
    max: "9007199254740991",
};

function splitIntegerString(s: string): { digits: string; negative: boolean } {
    const hasSign = s.startsWith("-");
    let digits = hasSign ? s.slice(1) : s;

    let firstNonZero = 0;
    while (firstNonZero < digits.length - 1 && digits[firstNonZero] === "0") {
        firstNonZero += 1;
    }

    digits = digits.slice(firstNonZero);

    // "-0" is just 0.
    return { digits, negative: hasSign && digits !== "0" };
}

/**
 * Compares two integers given as decimal strings, returning a negative
 * number, zero, or a positive number as `a` is less than, equal to, or
 * greater than `b`.  Handles signs and leading zeros, and is exact for
 * integers of any size.
 */
export function compareIntegerStrings(a: string, b: string): number {
    const sa = splitIntegerString(a);
    const sb = splitIntegerString(b);

    if (sa.negative !== sb.negative) {
        return sa.negative ? -1 : 1;
    }

    const sign = sa.negative ? -1 : 1;

    if (sa.digits.length !== sb.digits.length) {
        return sa.digits.length < sb.digits.length ? -sign : sign;
    }

    if (sa.digits === sb.digits) {
        return 0;
    }

    // Equal-length runs of digits compare lexicographically the same way
    // they compare numerically.
    return sa.digits < sb.digits ? -sign : sign;
}

/**
 * Decides whether an integer, given as its decimal string, lies within
 * `range` (inclusive).
 */
export function integerStringInRange(s: string, range: IntegerRange): boolean {
    return (
        compareIntegerStrings(s, range.min) >= 0 &&
        compareIntegerStrings(s, range.max) <= 0
    );
}
