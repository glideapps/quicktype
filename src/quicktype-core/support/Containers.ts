export function mapMap<K, V, W>(m: ReadonlyMap<K, V>, f: (v: V, k: K) => W): Map<K, W> {
    const result = new Map<K, W>();
    for (const [k, v] of m) {
        result.set(k, f(v, k));
    }
    return result;
}

export function mapSingle<K, V>(m: ReadonlyMap<K, V>): V | undefined {
    for (const v of m.values()) {
        return v;
    }
    return undefined;
}

export function setUnion<T>(...sets: ReadonlySet<T>[]): Set<T> {
    const result = new Set<T>();
    for (const set of sets) {
        for (const v of set) {
            result.add(v);
        }
    }
    return result;
}

export function setMap<T, U>(set: ReadonlySet<T>, f: (v: T) => U): Set<U> {
    const result = new Set<U>();
    for (const v of set) {
        result.add(f(v));
    }
    return result;
}

export function setFilter<T>(set: ReadonlySet<T>, p: (v: T) => boolean): Set<T> {
    const result = new Set<T>();
    for (const v of set) {
        if (p(v)) {
            result.add(v);
        }
    }
    return result;
}

export function setFind<T>(set: ReadonlySet<T>, p: (v: T) => boolean): T | undefined {
    for (const v of set) {
        if (p(v)) {
            return v;
        }
    }
    return undefined;
}
