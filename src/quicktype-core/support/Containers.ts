import { hashCodeInit, addHashCode, panic } from "./Support";
import { hash } from "immutable";

export function iterableFind<T>(it: Iterable<T>, p: (v: T) => boolean): T | undefined {
    for (const v of it) {
        if (p(v)) {
            return v;
        }
    }
    return undefined;
}

export function iterableEvery<T>(it: Iterable<T>, p: (v: T) => boolean): boolean {
    for (const v of it) {
        if (!p(v)) {
            return false;
        }
    }
    return true;
}

export function iterableSome<T>(it: Iterable<T>, p: (v: T) => boolean): boolean {
    for (const v of it) {
        if (p(v)) {
            return true;
        }
    }
    return false;
}

export function iterableFirst<T>(it: Iterable<T>): T | undefined {
    for (const v of it) {
        return v;
    }
    return undefined;
}

export function iterableMax(it: Iterable<number>): number | undefined {
    let max: number | undefined = undefined;
    for (const v of it) {
        if (max === undefined || v > max) {
            max = v;
        }
    }
    return max;
}

export function iterableMinBy<T>(it: Iterable<T>, key: (v: T) => number): T | undefined {
    let min: number | undefined = undefined;
    let minValue: T | undefined = undefined;
    for (const v of it) {
        const k = key(v);
        if (min === undefined || k < min) {
            min = k;
            minValue = v;
        }
    }
    return minValue;
}

export function iterableReduce<R, V>(it: Iterable<V>, unit: R, reducer: (r: R, v: V) => R): R {
    let result = unit;
    for (const v of it) {
        result = reducer(result, v);
    }
    return result;
}

export function* iterableEnumerate<T>(it: Iterable<T>): IterableIterator<[number, T]> {
    let i = 0;
    for (const v of it) {
        yield [i, v];
        i += 1;
    }
}

export function* iterableSkip<T>(it: Iterable<T>, n: number): IterableIterator<T> {
    let i = 0;
    for (const v of it) {
        if (i >= n) {
            yield v;
        } else {
            i += 1;
        }
    }
}

export function arrayIntercalate<T>(separator: T, items: Iterable<T>): T[] {
    const acc: T[] = [];
    for (const x of items) {
        if (acc.length > 0) acc.push(separator);
        acc.push(x);
    }
    return acc;
}

export function toReadonlyArray<T>(it: Iterable<T>): ReadonlyArray<T> {
    if (Array.isArray(it)) return it;
    return Array.from(it);
}

export function mapMap<K, V, W>(m: Iterable<[K, V]>, f: (v: V, k: K) => W): Map<K, W> {
    const result = new Map<K, W>();
    for (const [k, v] of m) {
        result.set(k, f(v, k));
    }
    return result;
}

export function mapFirst<K, V>(m: ReadonlyMap<K, V>): V | undefined {
    for (const v of m.values()) {
        return v;
    }
    return undefined;
}

export function mapContains<K, V>(m: ReadonlyMap<K, V>, valueToFind: V): boolean {
    for (const v of m.values()) {
        if (v === valueToFind) {
            return true;
        }
    }
    return false;
}

export function mapSome<K, V>(m: Iterable<[K, V]>, p: (v: V, k: K) => boolean): boolean {
    for (const [k, v] of m) {
        if (p(v, k)) {
            return true;
        }
    }
    return false;
}

export function mapMergeInto<K, V>(dest: Map<K, V>, src: Iterable<[K, V]>): void {
    for (const [k, v] of src) {
        dest.set(k, v);
    }
}

export function mapMerge<K, V>(ma: Iterable<[K, V]>, mb: Iterable<[K, V]>): Map<K, V> {
    const result = new Map(ma);
    mapMergeInto(result, mb);
    return result;
}

export function mapMergeWithInto<K, V>(ma: Map<K, V>, merger: (va: V, vb: V, k: K) => V, mb: Iterable<[K, V]>): void {
    for (const [k, vb] of mb) {
        const va = ma.get(k);
        const v = va === undefined ? vb : merger(va, vb, k);
        ma.set(k, v);
    }
}

export function mapMergeWith<K, V>(
    ma: Iterable<[K, V]>,
    merger: (va: V, vb: V, k: K) => V,
    mb: Iterable<[K, V]>
): Map<K, V> {
    const result = new Map(ma);
    mapMergeWithInto(result, merger, mb);
    return result;
}

export function mapFilter<K, V>(m: Iterable<[K, V]>, p: (v: V, k: K) => boolean): Map<K, V> {
    const result = new Map<K, V>();
    for (const [k, v] of m) {
        if (p(v, k)) {
            result.set(k, v);
        }
    }
    return result;
}

export function mapFilterMap<K, V, W>(m: Iterable<[K, V]>, f: (v: V, k: K) => W | undefined): Map<K, W> {
    const result = new Map<K, W>();
    for (const [k, v] of m) {
        const w = f(v, k);
        if (w !== undefined) {
            result.set(k, w);
        }
    }
    return result;
}

export function mapSortBy<K, V>(m: Iterable<[K, V]>, sortKey: (v: V, k: K) => number | string): Map<K, V> {
    const arr = Array.from(m);
    arr.sort(([ka, va], [kb, vb]) => {
        const sa = sortKey(va, ka);
        const sb = sortKey(vb, kb);
        if (sa < sb) return -1;
        if (sa > sb) return 1;
        return 0;
    });
    return new Map(arr);
}

export function mapSortByKey<K extends number | string, V>(m: Iterable<[K, V]>): Map<K, V> {
    return mapSortBy(m, (_, k) => k);
}

export function mapMapEntries<K, L, V, W>(m: Iterable<[K, V]>, f: (v: V, k: K) => [L, W]): Map<L, W> {
    const result = new Map<L, W>();
    for (const [k, v] of m) {
        const [l, w] = f(v, k);
        result.set(l, w);
    }
    return result;
}

export function mapUpdateInto<K, V>(m: Map<K, V>, k: K, updater: (v: V | undefined) => V): void {
    m.set(k, updater(m.get(k)));
}

export function mapFromObject<V>(obj: { [k: string]: V }): Map<string, V> {
    const result = new Map<string, V>();
    for (const k of Object.getOwnPropertyNames(obj)) {
        result.set(k, obj[k]);
    }
    return result;
}

export function mapFromIterable<K, V>(it: Iterable<K>, valueForKey: (k: K) => V): Map<K, V> {
    const result = new Map<K, V>();
    for (const k of it) {
        result.set(k, valueForKey(k));
    }
    return result;
}

export function mapFind<K, V>(it: Iterable<[K, V]>, p: (v: V, k: K) => boolean): V | undefined {
    for (const [k, v] of it) {
        if (p(v, k)) {
            return v;
        }
    }
    return undefined;
}

export async function mapMapSync<K, V, W>(m: Iterable<[K, V]>, f: (v: V, k: K) => Promise<W>): Promise<Map<K, W>> {
    const result = new Map<K, W>();
    for (const [k, v] of m) {
        result.set(k, await f(v, k));
    }
    return result;
}

export function setUnionIntoMany<T>(dest: Set<T>, srcs: Iterable<Iterable<T>>): void {
    for (const src of srcs) {
        for (const v of src) {
            dest.add(v);
        }
    }
}

export function setUnionInto<T>(dest: Set<T>, ...srcs: Iterable<T>[]): void {
    setUnionIntoMany(dest, srcs);
}

export function setIntersect<T>(s1: Iterable<T>, s2: ReadonlySet<T>): Set<T> {
    const result = new Set();
    for (const v of s1) {
        if (s2.has(v)) {
            result.add(v);
        }
    }
    return result;
}

export function setSubtract<T>(src: Iterable<T>, diff: Iterable<T>): Set<T> {
    const result = new Set(src);
    for (const v of diff) {
        result.delete(v);
    }
    return result;
}

export function setUnion<T>(...sets: Iterable<T>[]): Set<T> {
    const result = new Set<T>();
    setUnionInto(result, ...sets);
    return result;
}

export function setMap<T, U>(set: Iterable<T>, f: (v: T) => U): Set<U> {
    const result = new Set<U>();
    for (const v of set) {
        result.add(f(v));
    }
    return result;
}

export function setFilter<T>(set: Iterable<T>, p: (v: T) => boolean): Set<T> {
    const result = new Set<T>();
    for (const v of set) {
        if (p(v)) {
            result.add(v);
        }
    }
    return result;
}

export function setFilterMap<T, U>(set: Iterable<T>, f: (v: T) => U | undefined): Set<U> {
    const result = new Set<U>();
    for (const v of set) {
        const u = f(v);
        if (u !== undefined) {
            result.add(u);
        }
    }
    return result;
}

export function setGroupBy<T, G>(it: Iterable<T>, grouper: (v: T) => G): Map<G, Set<T>> {
    const result = new Map<G, Set<T>>();
    for (const v of it) {
        const g = grouper(v);
        let group = result.get(g);
        if (group === undefined) {
            group = new Set();
            result.set(g, group);
        }
        group.add(v);
    }
    return result;
}

export function toReadonlySet<T>(it: Iterable<T>): ReadonlySet<T> {
    if (it instanceof Set) return it;
    return new Set(it);
}

export interface Equality {
    equals(other: any): boolean;
    hashCode(): number;
}

export class EqualityMap<K extends Equality, V> {
    private readonly _map = new Map<number, [K, V]>();

    set(k: K, v: V): void {
        let h = k.hashCode() | 0;
        for (;;) {
            const kvp = this._map.get(h);
            if (kvp === undefined) {
                this._map.set(h, [k, v]);
                return;
            }
            if (k.equals(kvp[0])) {
                kvp[1] = v;
                return;
            }
            h = (h + 1) | 0;
        }
    }

    get(k: K): V | undefined {
        let h = k.hashCode() | 0;
        for (;;) {
            const kvp = this._map.get(h);
            if (kvp === undefined) {
                return undefined;
            }
            if (k.equals(kvp[0])) {
                return kvp[1];
            }
            h = (h + 1) | 0;
        }
    }
}

export function areEqual(a: any, b: any): boolean {
    if (a === b) {
        return true;
    }

    if (typeof a.equals === "function" && typeof b.equals === "function") {
        return a.equals(b);
    }

    if (a instanceof Set && b instanceof Set) {
        if (a.size !== b.size) return false;

        for (const x of a) {
            if (!b.has(x)) return false;
        }
        return true;
    }

    if (a instanceof Map && b instanceof Map) {
        if (a.size !== b.size) return false;

        for (const [k, v] of a) {
            const w = b.get(k);
            if (!areEqual(v, w)) return false;
        }
        return true;
    }

    return false;
}

export function hashCodeOf(x: any): number {
    if (typeof x === "number") return x | 0;
    if (typeof x === "string") return hash(x);

    let h = hashCodeInit;

    if (x === undefined) return h;
    if (x === true) return h + 1;
    if (x === false) return h + 2;

    if (typeof x.hashCode === "function") return x.hashCode();

    if (x instanceof Set) {
        for (const y of x) {
            h += hashCodeOf(y);
        }
        return h;
    }

    if (x instanceof Map) {
        let g = hashCodeInit;
        for (const [k, v] of x) {
            g += hashCodeOf(k);
            h += hashCodeOf(v);
        }
        return addHashCode(g, h);
    }

    return panic(`Cannot hash ${x}`);
}
