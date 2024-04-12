import { encodedMarkovChain } from "./EncodedMarkovChain";
import { assert, inflateBase64, panic } from "./support/Support";

// This must be null, not undefined, because we read it from JSON.
export type SubTrie = number | null | Trie;
export interface Trie {
    arr: SubTrie[];
    count: number;
}

export interface MarkovChain {
    depth: number;
    trie: Trie;
}

function makeTrie(): Trie {
    const arr: SubTrie[] = [];
    for (let i = 0; i < 128; i++) {
        arr.push(null);
    }

    return { count: 0, arr };
}

function lookup(t: Trie, seq: string, i: number): Trie | number | undefined {
    if (i >= seq.length) {
        return t;
    }

    let first = seq.charCodeAt(i);
    if (first >= 128) {
        first = 0;
    }

    const n = t.arr[first];
    if (n === null) {
        return undefined;
    }

    if (typeof n === "object") {
        return lookup(n, seq, i + 1);
    } else {
        return n / t.count;
    }
}

function increment(t: Trie, seq: string, i: number): void {
    let first = seq.charCodeAt(i);
    if (first >= 128) {
        first = 0;
    }

    if (i >= seq.length - 1) {
        if (typeof t !== "object") {
            return panic("Malformed trie");
        }

        let n = t.arr[first];
        if (n === null) {
            n = 0;
        } else if (typeof n === "object") {
            return panic("Malformed trie");
        }

        t.arr[first] = n + 1;
        t.count += 1;
        return;
    }

    let st = t.arr[first];
    if (st === null) {
        t.arr[first] = st = makeTrie();
    }

    if (typeof st !== "object") {
        return panic("Malformed trie");
    }

    increment(st, seq, i + 1);
}

export function train(lines: string[], depth: number): MarkovChain {
    const trie = makeTrie();
    for (const l of lines) {
        for (let i = depth; i <= l.length; i++) {
            increment(trie, l.slice(i - depth, i), 0);
        }
    }

    return { trie, depth };
}

export function load(): MarkovChain {
    return JSON.parse(inflateBase64(encodedMarkovChain));
}

export function evaluateFull(mc: MarkovChain, word: string): [number, number[]] {
    const { trie, depth } = mc;
    if (word.length < depth) {
        return [1, []];
    }

    let p = 1;
    const scores: number[] = [];
    for (let i = depth; i <= word.length; i++) {
        let cp = lookup(trie, word.slice(i - depth, i), 0);
        if (typeof cp === "object") {
            return panic("Did we mess up the depth?");
        }

        if (cp === undefined) {
            cp = 0.0001;
        }

        scores.push(cp);
        p = p * cp;
    }

    return [Math.pow(p, 1 / (word.length - depth + 1)), scores];
}

export function evaluate(mc: MarkovChain, word: string): number {
    return evaluateFull(mc, word)[0];
}

function randomInt(lower: number, upper: number) {
    const range = upper - lower;
    return lower + Math.floor(Math.random() * range);
}

export function generate(mc: MarkovChain, state: string, unseenWeight: number): string {
    assert(state.length === mc.depth - 1, "State and chain length don't match up");
    const t = lookup(mc.trie, state, 0);
    if (typeof t === "number") {
        return panic("Wrong depth?");
    }

    if (t === undefined) {
        return String.fromCharCode(randomInt(32, 127));
    }

    const counts = t.arr.map((x, i) => (x === null ? (i === 0 ? 0 : unseenWeight) : (x as number)));
    let n = 0;
    for (const c of counts) {
        n += c;
    }

    const r = randomInt(0, n);
    let sum = 0;
    for (let i = 0; i < counts.length; i++) {
        sum += counts[i];
        if (r < sum) {
            return String.fromCharCode(i);
        }
    }

    return panic("We screwed up bookkeeping, or randomInt");
}

function testWord(mc: MarkovChain, word: string): void {
    console.log(`"${word}": ${evaluate(mc, word)}`);
}

export function test(): void {
    const mc = load();

    testWord(mc, "url");
    testWord(mc, "json");
    testWord(mc, "my_property");
    testWord(mc, "ordinary");
    testWord(mc, "different");
    testWord(mc, "189512");
    testWord(mc, "2BTZIqw0ntH9MvilQ3ewNY");
    testWord(mc, "0uBTNdNGb2OY5lou41iYL52LcDq2");
    testWord(mc, "-KpqHmWuDOUnr1hmAhxp");
    testWord(mc, "granularity");
    testWord(mc, "coverage");
    testWord(mc, "postingFrequency");
    testWord(mc, "dataFrequency");
    testWord(mc, "units");
    testWord(mc, "datasetOwner");
    testWord(mc, "organization");
    testWord(mc, "timePeriod");
    testWord(mc, "contactInformation");

    testWord(
        mc,
        "\ud83d\udebe \ud83c\udd92 \ud83c\udd93 \ud83c\udd95 \ud83c\udd96 \ud83c\udd97 \ud83c\udd99 \ud83c\udfe7"
    );
}
