"use strict";

import { Collection, List } from "immutable";

export function intercalate<T>(separator: T, items: Collection<any, T>): List<T> {
    const acc: T[] = [];
    items.forEach((x: T) => {
        if (acc.length > 0) acc.push(separator);
        acc.push(x);
    });
    return List(acc);
}

export type StringMap = { [name: string]: any };

export function checkStringMap(x: any): StringMap {
    if (typeof x !== "object") {
        return panic(`Value must be an object, but is ${x}`);
    }
    return x;
}

export function checkArray(x: any): any[] {
    if (!Array.isArray(x)) {
        return panic(`Value must be an array, but is ${x}`);
    }
    return x;
}

export function defined<T>(x: T | undefined): T {
    if (x !== undefined) return x;
    return panic("Defined value expected, but got undefined");
}

export function nonNull<T>(x: T | null): T {
    if (x !== null) return x;
    return panic("Non-null value expected, but got null");
}

export function assertNever(x: never): never {
    throw new Error("Unexpected object: " + x);
}

export function assert(condition: boolean, message: string = "Assertion failed"): void {
    if (!condition) {
        throw Error(message);
    }
}

export function panic(message: string): never {
    throw Error(message);
}

export const hashCodeInit = 17;

export function addHashCode(acc: number, h: number): number {
    return (acc * 31 + (h | 0)) | 0;
}

export function repeated<T>(n: number, value: T): T[] {
    const arr: T[] = [];
    for (let i = 0; i < n; i++) {
        arr.push(value);
    }
    return arr;
}

export function repeatedCall<T>(n: number, producer: () => T): T[] {
    const arr: T[] = [];
    for (let i = 0; i < n; i++) {
        arr.push(producer());
    }
    return arr;
}
