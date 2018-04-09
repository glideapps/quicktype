"use strict";

import { Collection, List, Set, isKeyed, isIndexed } from "immutable";

import { Base64 } from "js-base64";
import * as pako from "pako";
import { messageError, ErrorMessage } from "./Messages";

export function intercalate<T>(separator: T, items: Collection<any, T>): List<T> {
    const acc: T[] = [];
    items.forEach((x: T) => {
        if (acc.length > 0) acc.push(separator);
        acc.push(x);
    });
    return List(acc);
}

export function setUnion<T, TSet extends Set<T>>(a: TSet, b: TSet): TSet {
    return a.union(b) as TSet;
}

export function unionOfSets<T, TSet extends Set<T>>(sets: TSet[]): TSet {
    if (sets.length === 0) {
        return Set() as TSet;
    }
    return sets[0].union(...sets.slice(1)) as TSet;
}

export type StringMap = { [name: string]: any };

export function isStringMap(x: any): x is StringMap;
export function isStringMap<T>(x: any, checkValue: (v: any) => v is T): x is { [name: string]: T };
export function isStringMap<T>(x: any, checkValue?: (v: any) => v is T): boolean {
    if (typeof x !== "object" || Array.isArray(x) || x === null) {
        return false;
    }
    if (checkValue !== undefined) {
        for (const k of Object.getOwnPropertyNames(x)) {
            const v = x[k];
            if (!checkValue(v)) {
                return false;
            }
        }
    }
    return true;
}

export function checkStringMap(x: any): StringMap;
export function checkStringMap<T>(x: any, checkValue: (v: any) => v is T): { [name: string]: T };
export function checkStringMap<T>(x: any, checkValue?: (v: any) => v is T): StringMap {
    if (isStringMap(x, checkValue as any)) return x;
    return panic(`Value must be an object, but is ${x}`);
}

export function checkArray(x: any): any[];
export function checkArray<T>(x: any, checkItem: (v: any) => v is T): T[];
export function checkArray<T>(x: any, checkItem?: (v: any) => v is T): T[] {
    if (!Array.isArray(x)) {
        return panic(`Value must be an array, but is ${x}`);
    }
    if (checkItem !== undefined) {
        for (const v of x) {
            if (!checkItem(v)) {
                return panic(`Array item does not satisfy constraint: ${v}`);
            }
        }
    }
    return x;
}

export function mapOptional<T, U>(f: (x: T) => U, x: T | undefined): U | undefined {
    if (x === undefined) return undefined;
    return f(x);
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
    return messageError(ErrorMessage.InternalError, { message: `Unexpected object ${x}` });
}

export function assert(condition: boolean, message: string = "Assertion failed"): void {
    if (!condition) {
        return messageError(ErrorMessage.InternalError, { message });
    }
}

export function panic(message: string): never {
    return messageError(ErrorMessage.InternalError, { message });
}

export function mustNotBeCalled(): never {
    return panic("This must not be called");
}

export function mustNotHappen(): never {
    return panic("This must not happen");
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

export function withDefault<T>(x: T | null | undefined, theDefault: T): T {
    if (x !== null && x !== undefined) {
        return x;
    }
    return theDefault;
}

export async function forEachSync<V>(coll: V[], f: (v: V, k: number) => Promise<void>): Promise<void>;
export async function forEachSync<K, V>(coll: Collection.Keyed<K, V>, f: (v: V, k: K) => Promise<void>): Promise<void>;
export async function forEachSync<V>(coll: Collection.Set<V>, f: (v: V, k: V) => Promise<void>): Promise<void>;
export async function forEachSync<V>(coll: Collection.Indexed<V>, f: (v: V, k: number) => Promise<void>): Promise<void>;
export async function forEachSync<K, V>(coll: Collection<K, V> | V[], f: (v: V, k: K) => Promise<void>): Promise<void> {
    if (Array.isArray(coll) || isIndexed(coll)) {
        const arr = Array.isArray(coll) ? coll : (coll as Collection.Indexed<V>).toArray();
        for (let i = 0; i < arr.length; i++) {
            // If the collection is indexed, then `K` is `number`, but
            // TypeScript doesn't know this.
            await f(arr[i], i as any);
        }
    } else if (isKeyed(coll)) {
        for (const [k, v] of (coll as Collection.Keyed<K, V>).toArray()) {
            await f(v, k);
        }
    } else {
        // I don't understand why we can't directly cast to `Collection.Set`.
        for (const v of ((coll as any) as Collection.Set<V>).toArray()) {
            // If the collection is a set, then `K` is the same as `v`,
            // but TypeScript doesn't know this.
            await f(v, v as any);
        }
    }
}

export async function mapSync<V, U>(coll: V[], f: (v: V, k: number) => Promise<U>): Promise<U[]>;
export async function mapSync<K, V, U>(
    coll: Collection.Keyed<K, V>,
    f: (v: V, k: K) => Promise<U>
): Promise<Collection.Keyed<K, U>>;
export async function mapSync<V, U>(coll: Collection.Set<V>, f: (v: V, k: V) => Promise<U>): Promise<Collection.Set<U>>;
export async function mapSync<V, U>(
    coll: Collection.Indexed<V>,
    f: (v: V, k: number) => Promise<U>
): Promise<Collection.Indexed<U>>;
export async function mapSync<K, V, U>(
    coll: Collection<K, V> | V[],
    f: (v: V, k: K) => Promise<U>
): Promise<Collection<K, U> | U[]> {
    const results: U[] = [];
    await forEachSync(coll as any, async (v, k) => {
        results.push(await f(v as any, k as any));
    });

    let index = 0;
    if (Array.isArray(coll)) {
        return results;
    }
    return coll.map(_v => results[index++]);
}

export function inflateBase64(encoded: string): string {
    const bytes = Base64.atob(encoded);
    return pako.inflate(bytes, { to: "string" });
}

export function parseJSON(text: string, description: string, address: string = "<unknown>"): any {
    try {
        return JSON.parse(text);
    } catch (e) {
        let message: string;

        if (e instanceof SyntaxError) {
            message = e.message;
        } else {
            message = `Unknown exception ${e}`;
        }

        return messageError(ErrorMessage.MiscJSONParseError, { description, address, message });
    }
}
