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

export function setUnion<T>(...sets: Iterable<T>[]): Set<T> {
    const result = new Set<T>();
    for (const set of sets) {
        for (const v of set) {
            result.add(v);
        }
    }
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
