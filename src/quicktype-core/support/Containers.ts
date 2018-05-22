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

export function* iterableEnumerate<T>(it: Iterable<T>): IterableIterator<[number, T]> {
    let i = 0;
    for (const v of it) {
        yield [i, v];
        i += 1;
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

export function mapMap<K, V, W>(m: ReadonlyMap<K, V>, f: (v: V, k: K) => W): Map<K, W> {
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

export function mapMergeInto<K, V>(dest: Map<K, V>, src: ReadonlyMap<K, V>): void {
    for (const [k, v] of src) {
        dest.set(k, v);
    }
}

export function mapFilter<K, V>(m: ReadonlyMap<K, V>, p: (v: V, k: K) => boolean): Map<K, V> {
    const result = new Map<K, V>();
    for (const [k, v] of m) {
        if (p(v, k)) {
            result.set(k, v);
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
