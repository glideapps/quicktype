"use strict";

import * as fs from "fs";

import { panic } from "./Support";

export type SubTrie = number | undefined | Trie;
export type Trie = {
    count: number;
    arr: SubTrie[];
};

export type MarkovChain = {
    trie: Trie;
    depth: number;
};

function makeTrie(): Trie {
    const arr: SubTrie[] = [];
    for (let i = 0; i < 128; i++) {
        arr.push(undefined);
    }
    return { count: 0, arr };
}

function lookup(t: Trie, seq: string, i: number): number | undefined {
    let first = seq.charCodeAt(i);
    if (first >= 128) {
        first = 0;
    }

    if (i >= seq.length - 1) {
        if (typeof t !== "object") {
            return panic("Malformed trie");
        }
        const n = t.arr[first];
        if (typeof n === "object") {
            return panic("Malformed trie");
        }
        if (n === undefined) {
            return undefined;
        }
        return n / t.count;
    }

    const st = t.arr[first];
    if (st === undefined) {
        return undefined;
    }
    if (typeof st !== "object") {
        return panic("Malformed trie");
    }
    return lookup(st, seq, i + 1);
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
        if (typeof n === "object") {
            return panic("Malformed trie");
        }
        if (n === undefined) {
            n = 0;
        }
        t.arr[first] = n + 1;
        t.count += 1;
        return;
    }

    let st = t.arr[first];
    if (st === undefined) {
        t.arr[first] = st = makeTrie();
    }
    if (typeof st !== "object") {
        return panic("Malformed trie");
    }
    return increment(st, seq, i + 1);
}

export function train(filename: string, depth: number): MarkovChain {
    const contents = fs.readFileSync(filename).toString();
    const lines = contents.split("\n");
    const trie = makeTrie();
    for (const l of lines) {
        for (let i = depth; i <= l.length; i++) {
            increment(trie, l.substr(i - depth, depth), 0);
        }
    }

    const mc = { trie, depth };

    fs.writeFileSync("/tmp/markov.json", JSON.stringify(runLengthEncodeMarkovChain(mc)));

    return mc;
}

export function evaluate(mc: MarkovChain, word: string): number {
    const { trie, depth } = mc;
    if (word.length < depth) {
        return 1;
    }
    let p = 1;
    for (let i = depth; i <= word.length; i++) {
        let cp = lookup(trie, word.substr(i - depth, depth), 0);
        if (cp === undefined) {
            cp = 0.0001;
        }
        p = p * cp;
    }
    return Math.pow(p, 1 / (word.length - depth + 1));
}

function testWord(mc: MarkovChain, word: string): void {
    console.log(`"${word}": ${evaluate(mc, word)}`);
}

export function test(mc: MarkovChain): void {
    testWord(mc, "url");
    testWord(mc, "json");
    testWord(mc, "my_property");
    testWord(mc, "ordinary");
    testWord(mc, "different");
    testWord(mc, "189512");
    testWord(mc, "2BTZIqw0ntH9MvilQ3ewNY");
    testWord(mc, "0uBTNdNGb2OY5lou41iYL52LcDq2");
    testWord(mc, "-KpqHmWuDOUnr1hmAhxp");
    testWord(
        mc,
        "\ud83d\udebe \ud83c\udd92 \ud83c\udd93 \ud83c\udd95 \ud83c\udd96 \ud83c\udd97 \ud83c\udd99 \ud83c\udfe7"
    );
}

function runLengthEncodeArray<T>(arr: T[]): [number, T][] {
    const result: [number, T][] = [];
    if (arr.length === 0) return result;
    let runItem: T = arr[0];
    let runStart = 0;
    let i = 1;

    while (i < arr.length) {
        const item = arr[i];
        if (item !== runItem) {
            result.push([i - runStart, runItem]);
            runItem = item;
            runStart = i;
        }
        i++;
    }
    result.push([i - runStart, runItem]);

    return result;
}

function runLengthEncodeTrie(t: Trie): any {
    return {
        count: t.count,
        arr: runLengthEncodeArray(
            t.arr.map(x => {
                if (typeof x === "object") {
                    return runLengthEncodeTrie(x);
                }
                return x;
            })
        )
    };
}

function runLengthEncodeMarkovChain(mc: MarkovChain): any {
    return { depth: mc.depth, trie: runLengthEncodeTrie(mc.trie) };
}
