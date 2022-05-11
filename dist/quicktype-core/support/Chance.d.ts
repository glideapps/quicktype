export declare class Chance {
    readonly seed: number;
    private mt;
    constructor(seed: number);
    random(): number;
    /**
     *  Return a random integer
     *
     *  NOTE the max and min are INCLUDED in the range. So:
     *  chance.integer({min: 1, max: 3});
     *  would return either 1, 2, or 3.
     *
     *  @param {Object} [options={}] can specify a min and/or max
     *  @returns {Number} a single random integer number
     *  @throws {RangeError} min cannot be greater than max
     */
    integer(options: {
        min: number;
        max: number;
    }): number;
    /**
     *  Return a random natural
     *
     *  NOTE the max and min are INCLUDED in the range. So:
     *  chance.natural({min: 1, max: 3});
     *  would return either 1, 2, or 3.
     *
     *  @param {Object} [options={}] can specify a min and/or maxm or a numerals count.
     *  @returns {Number} a single random integer number
     *  @throws {RangeError} min cannot be greater than max
     */
    natural(options: {
        max: number;
    }): number;
    pick<T>(arr: T[]): T;
    animal(): string;
    city(): string;
}
