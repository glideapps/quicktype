#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import { evaluate, load } from "../packages/quicktype-core/dist/MarkovChain.js";

const alphabet =
    " -0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
const alphabetSize = alphabet.length;
const unseenProbability = 0.0001;
const characterIndexes = new Int8Array(128).fill(-1);
for (let i = 0; i < alphabetSize; i++) {
    characterIndexes[alphabet.charCodeAt(i)] = i;
}

function percentile(sorted, fraction) {
    return sorted[
        Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
    ];
}

function findJsonFiles(path) {
    if (!statSync(path).isDirectory())
        return extname(path) === ".json" ? [path] : [];
    return readdirSync(path).flatMap((entry) =>
        findJsonFiles(join(path, entry)),
    );
}

function exactRows(chain) {
    const rows = [];
    for (const first of alphabet) {
        const firstTrie = chain.trie.arr[first.charCodeAt(0)];
        for (const second of alphabet) {
            const context =
                firstTrie !== null && typeof firstTrie === "object"
                    ? firstTrie.arr[second.charCodeAt(0)]
                    : null;
            const counts = new Uint32Array(alphabetSize);
            let total = 0;
            if (context !== null && typeof context === "object") {
                for (let character = 0; character < alphabetSize; character++) {
                    const count = context.arr[alphabet.charCodeAt(character)];
                    if (typeof count === "number") {
                        counts[character] = count;
                        total += count;
                    }
                }
            }
            rows.push({ counts, total });
        }
    }
    return rows;
}

function exactEvaluate(modelRows, word) {
    if (word.length < 3) return 1;
    let first = characterIndexes[word.charCodeAt(0)];
    let second = characterIndexes[word.charCodeAt(1)];
    let probability = 1;
    for (let i = 2; i < word.length; i++) {
        const third = characterIndexes[word.charCodeAt(i)];
        let score = unseenProbability;
        if (first >= 0 && second >= 0 && third >= 0) {
            const row = modelRows[first * alphabetSize + second];
            const count = row.counts[third];
            if (count !== 0) score = count / row.total;
        }
        probability *= score;
        first = second;
        second = third;
    }
    return probability ** (1 / (word.length - 2));
}

function mapLimit(propertyCount) {
    const exponent = 5;
    const scale = 22 ** exponent;
    return (
        (propertyCount + 2) ** exponent / scale +
        (0.0025 - 3 ** exponent / scale)
    );
}

function rawValueKind(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}

function survivesRawValueGuards(value) {
    const kinds = new Set(
        Object.values(value)
            .map(rawValueKind)
            .filter((kind) => kind !== "null"),
    );
    if (kinds.size === 0 || (kinds.size === 1 && kinds.has("string"))) {
        return false;
    }
    return kinds.size === 1;
}

const [, , chainPath, ...argumentsAfterChain] = process.argv;
const showDetails = argumentsAfterChain.includes("--details");
const inputPaths = argumentsAfterChain.filter(
    (argument) => argument !== "--details",
);
if (chainPath === undefined) {
    throw new Error(
        "Usage: node script/benchmark-markov-fidelity.mjs MARKOV.json [JSON_FILE_OR_DIRECTORY ...]",
    );
}

const source = JSON.parse(readFileSync(chainPath, "utf8"));
const rows = exactRows(source);
const compact = load();
const transitionErrors = [];
let collapsedTransitions = 0;
for (let prefix = 0; prefix < rows.length; prefix++) {
    const row = rows[prefix];
    if (row.total === 0) continue;
    for (let character = 0; character < alphabetSize; character++) {
        const count = row.counts[character];
        if (count === 0) continue;
        const code =
            compact.probabilityCodes[prefix * alphabetSize + character];
        const approximate =
            code === 0 ? unseenProbability : compact.probabilities[code];
        const exact = count / row.total;
        transitionErrors.push(Math.abs(Math.log(approximate / exact)));
        if (code === 0) collapsedTransitions++;
    }
}
transitionErrors.sort((a, b) => a - b);

const propertyNames = new Set();
const propertyGroups = [];
function visit(value, sourcePath) {
    if (Array.isArray(value)) {
        for (const item of value) visit(item, sourcePath);
    } else if (value !== null && typeof value === "object") {
        const names = Object.keys(value);
        for (const name of names) propertyNames.add(name);
        if (
            names.length >= 2 &&
            names.length < 20 &&
            !names.every((name) => /^[0-9]+$/.test(name))
        ) {
            propertyGroups.push({
                names,
                sourcePath,
                survivesRawValueGuards: survivesRawValueGuards(value),
            });
        }
        for (const item of Object.values(value)) visit(item, sourcePath);
    }
}
for (const path of inputPaths.flatMap(findJsonFiles)) {
    try {
        visit(JSON.parse(readFileSync(path, "utf8")), path);
    } catch {
        // Some fixture directories deliberately contain malformed JSON.
    }
}

const nameErrors = [];
let nameLogBias = 0;
for (const name of propertyNames) {
    const exact = exactEvaluate(rows, name);
    const approximate = evaluate(compact, name);
    if (
        !Number.isFinite(exact) ||
        !Number.isFinite(approximate) ||
        exact <= 0 ||
        approximate <= 0
    ) {
        continue;
    }
    nameErrors.push(Math.abs(Math.log(approximate / exact)));
    nameLogBias += Math.log(exact / approximate);
}
nameErrors.sort((a, b) => a - b);

let decisionChanges = 0;
let eligibleDecisionChanges = 0;
const changedGroups = [];
const groupScores = [];
for (const {
    names,
    sourcePath,
    survivesRawValueGuards: rawValueGuardsSurvived,
} of propertyGroups) {
    const exact =
        names.reduce(
            (product, name) => product * exactEvaluate(rows, name),
            1,
        ) **
        (1 / names.length);
    const approximate =
        names.reduce((product, name) => product * evaluate(compact, name), 1) **
        (1 / names.length);
    const limit = mapLimit(names.length);
    groupScores.push({ exact, approximate, limit, names, sourcePath });
    if (exact > limit !== approximate > limit) {
        decisionChanges++;
        if (rawValueGuardsSurvived) eligibleDecisionChanges++;
        changedGroups.push({
            names,
            sourcePath,
            exact,
            approximate,
            limit,
            direction: exact > limit ? "class -> map" : "map -> class",
            survivesRawValueGuards: rawValueGuardsSurvived,
        });
    }
}

console.log("Markov approximation fidelity");
console.log(`  Exact nonzero transitions: ${transitionErrors.length}`);
console.log(`  Collapsed to unseen:       ${collapsedTransitions}`);
console.log(
    `  Transition median factor: ${(Math.exp(percentile(transitionErrors, 0.5))).toFixed(3)}x`,
);
console.log(
    `  Transition p95 factor:    ${(Math.exp(percentile(transitionErrors, 0.95))).toFixed(3)}x`,
);
console.log(`  Unique fixture names:      ${propertyNames.size}`);
if (nameErrors.length > 0) {
    console.log(
        `  Name-score median factor: ${(Math.exp(percentile(nameErrors, 0.5))).toFixed(3)}x`,
    );
    console.log(
        `  Name-score p95 factor:    ${(Math.exp(percentile(nameErrors, 0.95))).toFixed(3)}x`,
    );
    console.log(
        `  Bias-correcting scale:     ${Math.exp(nameLogBias / nameErrors.length).toFixed(6)}`,
    );
}
console.log(`  Map-decision candidates:   ${propertyGroups.length}`);
console.log(`  Changed score gates:       ${decisionChanges}`);
console.log(`  Surviving raw-type guards: ${eligibleDecisionChanges}`);
let minimumSafeScale = 0;
let maximumSafeScale = Number.POSITIVE_INFINITY;
let limitingClassGroup;
let limitingMapGroup;
for (const group of groupScores) {
    const { exact, approximate, limit } = group;
    if (exact > limit) {
        const requiredScale = limit / approximate;
        if (requiredScale > minimumSafeScale) {
            minimumSafeScale = requiredScale;
            limitingClassGroup = group;
        }
    } else {
        const requiredScale = limit / approximate;
        if (requiredScale < maximumSafeScale) {
            maximumSafeScale = requiredScale;
            limitingMapGroup = group;
        }
    }
}
console.log(
    `  Decision-safe score scale: ${minimumSafeScale.toFixed(6)} .. ${maximumSafeScale.toFixed(6)}`,
);
if (showDetails) {
    for (const [label, group] of [
        ["Closest original class", limitingClassGroup],
        ["Closest original map", limitingMapGroup],
    ]) {
        console.log("");
        console.log(`${label}: ${JSON.stringify(group.names)}`);
        console.log(
            `  exact=${group.exact.toFixed(6)}, compact=${group.approximate.toFixed(6)}, limit=${group.limit.toFixed(6)}`,
        );
        console.log(`  ${group.sourcePath}`);
    }
    const unique = new Map();
    for (const group of changedGroups) {
        const key = `${group.direction}:${group.names.join("\u0000")}`;
        const existing = unique.get(key);
        if (existing === undefined) {
            unique.set(key, { ...group, occurrences: 1 });
        } else {
            existing.occurrences++;
        }
    }
    const groups = [...unique.values()].sort(
        (a, b) => b.occurrences - a.occurrences,
    );
    console.log(`  Unique changed key sets:   ${groups.length}`);
    console.log("");
    for (const group of groups) {
        console.log(
            `${group.direction} (${group.occurrences}x): exact=${group.exact.toFixed(6)}, compact=${group.approximate.toFixed(6)}, limit=${group.limit.toFixed(6)}`,
        );
        console.log(
            `  survives raw-value guards: ${group.survivesRawValueGuards}`,
        );
        console.log(`  ${JSON.stringify(group.names)}`);
        console.log(`  ${group.sourcePath}`);
    }
}
