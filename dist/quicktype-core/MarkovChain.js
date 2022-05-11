"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Support_1 = require("./support/Support");
const EncodedMarkovChain_1 = require("./EncodedMarkovChain");
function makeTrie() {
    const arr = [];
    for (let i = 0; i < 128; i++) {
        arr.push(null);
    }
    return { count: 0, arr };
}
function lookup(t, seq, i) {
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
    }
    else {
        return n / t.count;
    }
}
function increment(t, seq, i) {
    let first = seq.charCodeAt(i);
    if (first >= 128) {
        first = 0;
    }
    if (i >= seq.length - 1) {
        if (typeof t !== "object") {
            return Support_1.panic("Malformed trie");
        }
        let n = t.arr[first];
        if (n === null) {
            n = 0;
        }
        else if (typeof n === "object") {
            return Support_1.panic("Malformed trie");
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
        return Support_1.panic("Malformed trie");
    }
    return increment(st, seq, i + 1);
}
function train(lines, depth) {
    const trie = makeTrie();
    for (const l of lines) {
        for (let i = depth; i <= l.length; i++) {
            increment(trie, l.substr(i - depth, depth), 0);
        }
    }
    return { trie, depth };
}
exports.train = train;
function load() {
    return JSON.parse(Support_1.inflateBase64(EncodedMarkovChain_1.encodedMarkovChain));
}
exports.load = load;
function evaluateFull(mc, word) {
    const { trie, depth } = mc;
    if (word.length < depth) {
        return [1, []];
    }
    let p = 1;
    const scores = [];
    for (let i = depth; i <= word.length; i++) {
        let cp = lookup(trie, word.substr(i - depth, depth), 0);
        if (typeof cp === "object") {
            return Support_1.panic("Did we mess up the depth?");
        }
        if (cp === undefined) {
            cp = 0.0001;
        }
        scores.push(cp);
        p = p * cp;
    }
    return [Math.pow(p, 1 / (word.length - depth + 1)), scores];
}
exports.evaluateFull = evaluateFull;
function evaluate(mc, word) {
    return evaluateFull(mc, word)[0];
}
exports.evaluate = evaluate;
function randomInt(lower, upper) {
    const range = upper - lower;
    return lower + Math.floor(Math.random() * range);
}
function generate(mc, state, unseenWeight) {
    Support_1.assert(state.length === mc.depth - 1, "State and chain length don't match up");
    const t = lookup(mc.trie, state, 0);
    if (typeof t === "number") {
        return Support_1.panic("Wrong depth?");
    }
    if (t === undefined) {
        return String.fromCharCode(randomInt(32, 127));
    }
    const counts = t.arr.map((x, i) => (x === null ? (i === 0 ? 0 : unseenWeight) : x));
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
    return Support_1.panic("We screwed up bookkeeping, or randomInt");
}
exports.generate = generate;
function testWord(mc, word) {
    console.log(`"${word}": ${evaluate(mc, word)}`);
}
function test() {
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
    testWord(mc, "\ud83d\udebe \ud83c\udd92 \ud83c\udd93 \ud83c\udd95 \ud83c\udd96 \ud83c\udd97 \ud83c\udd99 \ud83c\udfe7");
}
exports.test = test;
