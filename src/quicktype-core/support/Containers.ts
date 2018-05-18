export function mapMap<K, V, W>(m: ReadonlyMap<K, V>, f: (v: V, k: K) => W): Map<K, W> {
    const result = new Map<K, W>();
    m.forEach((v, k) => result.set(k, f(v, k)));
    return result;
}

export function mapSingle<K, V>(m: ReadonlyMap<K, V>): V | undefined {
    if (m.size > 1) return undefined;
    let result: V | undefined = undefined;
    m.forEach(v => (result = v));
    return result;
}
