#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

const alphabet =
    " -0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
const alphabetSize = alphabet.length;
const base91Alphabet =
    "!#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}";
const unseenProbability = 0.0001;
const probabilityLevelCount = 5;
const entropyModelCount = 16;
// The compact levels slightly underestimate scores for real-world property
// names.  This value sits near the middle of the interval that preserves every
// original map-inference score gate in the full JSON fixture corpus.
const probabilityCalibration = 1.2;
const scaleBits = 12;
const scale = 1 << scaleBits;
const ransLowerBound = 1 << 23;

function extractRows(chain) {
    if (chain.depth !== 3) {
        throw new Error(
            `Expected a depth-3 Markov chain, got depth ${chain.depth}`,
        );
    }

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

function quantizeProbabilities(rows) {
    const unseenLog = Math.log(unseenProbability);
    const logs = [];
    for (const row of rows) {
        if (row.total === 0) continue;
        for (const count of row.counts) {
            if (count !== 0) {
                logs.push(Math.log(count / row.total));
            }
        }
    }
    logs.sort((a, b) => a - b);
    const centers = Array.from(
        { length: probabilityLevelCount },
        (_, i) =>
            logs[Math.floor(((i + 0.5) * logs.length) / probabilityLevelCount)],
    );

    for (let iteration = 0; iteration < 100; iteration++) {
        const sums = new Float64Array(probabilityLevelCount);
        const counts = new Uint32Array(probabilityLevelCount);
        for (const log of logs) {
            let best = -1;
            let bestDistance = Math.abs(log - unseenLog);
            for (let level = 0; level < probabilityLevelCount; level++) {
                const distance = Math.abs(log - centers[level]);
                if (distance < bestDistance) {
                    best = level;
                    bestDistance = distance;
                }
            }
            if (best >= 0) {
                sums[best] += log;
                counts[best]++;
            }
        }
        let movement = 0;
        for (let level = 0; level < probabilityLevelCount; level++) {
            if (counts[level] === 0) continue;
            const next = sums[level] / counts[level];
            movement += Math.abs(next - centers[level]);
            centers[level] = next;
        }
        if (movement < 1e-12) break;
    }

    const codes = new Uint8Array(alphabetSize ** 3);
    for (let prefix = 0; prefix < rows.length; prefix++) {
        const row = rows[prefix];
        if (row.total === 0) continue;
        for (let character = 0; character < alphabetSize; character++) {
            const count = row.counts[character];
            if (count === 0) continue;
            const log = Math.log(count / row.total);
            let best = 0;
            let bestDistance = Math.abs(log - unseenLog);
            for (let level = 0; level < probabilityLevelCount; level++) {
                const distance = Math.abs(log - centers[level]);
                if (distance < bestDistance) {
                    best = level + 1;
                    bestDistance = distance;
                }
            }
            codes[prefix * alphabetSize + character] = best;
        }
    }
    return {
        codes,
        probabilities: centers.map(
            (center) => Math.exp(center) * probabilityCalibration,
        ),
    };
}

function makeColumnHistograms(codes) {
    // Transposing the first character to the innermost dimension exposes 4,225
    // short distributions that are substantially easier to entropy-code.
    const histograms = [];
    for (let second = 0; second < alphabetSize; second++) {
        for (let character = 0; character < alphabetSize; character++) {
            const histogram = new Uint8Array(probabilityLevelCount + 1);
            for (let first = 0; first < alphabetSize; first++) {
                histogram[
                    codes[
                        (first * alphabetSize + second) * alphabetSize +
                            character
                    ]
                ]++;
            }
            histograms.push(histogram);
        }
    }
    return histograms;
}

function clusterHistograms(histograms) {
    // Share a small set of entropy models between statistically similar
    // columns.  The model assignment costs much less than it saves in the
    // probability-code stream.
    let best;
    for (let restart = 0; restart < 5; restart++) {
        const assignments = new Uint8Array(histograms.length);
        for (let i = 0; i < assignments.length; i++) {
            assignments[i] =
                (i * 2654435761 + restart * 1013904223) % entropyModelCount;
        }

        let changed = true;
        for (let iteration = 0; iteration < 100 && changed; iteration++) {
            const models = collectModelCounts(histograms, assignments, 0.5);
            changed = false;
            for (let i = 0; i < histograms.length; i++) {
                let bestModel = 0;
                let bestBits = Number.POSITIVE_INFINITY;
                for (let model = 0; model < entropyModelCount; model++) {
                    const total = models[model].reduce((a, b) => a + b, 0);
                    let bits = 0;
                    for (
                        let symbol = 0;
                        symbol <= probabilityLevelCount;
                        symbol++
                    ) {
                        const count = histograms[i][symbol];
                        if (count !== 0) {
                            bits -=
                                count *
                                Math.log2(models[model][symbol] / total);
                        }
                    }
                    if (bits < bestBits) {
                        bestBits = bits;
                        bestModel = model;
                    }
                }
                if (assignments[i] !== bestModel) {
                    assignments[i] = bestModel;
                    changed = true;
                }
            }
        }

        const modelCounts = collectModelCounts(histograms, assignments, 0);
        let bits = 0;
        for (let i = 0; i < histograms.length; i++) {
            const counts = modelCounts[assignments[i]];
            const total = counts.reduce((a, b) => a + b, 0);
            for (let symbol = 0; symbol <= probabilityLevelCount; symbol++) {
                const count = histograms[i][symbol];
                if (count !== 0) {
                    bits -= count * Math.log2(counts[symbol] / total);
                }
            }
        }
        if (best === undefined || bits < best.bits) {
            best = { assignments, bits, modelCounts };
        }
    }
    return best;
}

function collectModelCounts(histograms, assignments, smoothing) {
    const result = Array.from({ length: entropyModelCount }, () =>
        new Float64Array(probabilityLevelCount + 1).fill(smoothing),
    );
    for (let i = 0; i < histograms.length; i++) {
        const model = result[assignments[i]];
        for (let symbol = 0; symbol <= probabilityLevelCount; symbol++) {
            model[symbol] += histograms[i][symbol];
        }
    }
    return result;
}

function normalizeCounts(counts) {
    const total = counts.reduce((sum, count) => sum + count, 0);
    const exact = Array.from(counts, (count) => (count / total) * scale);
    const normalized = exact.map((value, symbol) =>
        counts[symbol] === 0 ? 0 : Math.max(1, Math.floor(value)),
    );
    let remaining = scale - normalized.reduce((sum, count) => sum + count, 0);
    const byRemainder = Array.from(counts, (_, symbol) => symbol).sort(
        (a, b) => exact[b] - normalized[b] - (exact[a] - normalized[a]),
    );
    for (let i = 0; remaining > 0; i++, remaining--) {
        normalized[byRemainder[i % byRemainder.length]]++;
    }
    const bySurplus = byRemainder.toReversed();
    for (let i = 0; remaining < 0; i++) {
        const symbol = bySurplus[i % bySurplus.length];
        if (normalized[symbol] <= 1) continue;
        normalized[symbol]--;
        remaining++;
    }
    return normalized;
}

function cumulativeFrequencies(frequencies) {
    const cumulative = [];
    let sum = 0;
    for (const frequency of frequencies) {
        cumulative.push(sum);
        sum += frequency;
    }
    if (sum !== scale) throw new Error(`Invalid frequency total ${sum}`);
    return cumulative;
}

function encodeRans(symbols, modelIndexes, models) {
    const cumulative = models.map(cumulativeFrequencies);
    const renormalized = [];
    let state = ransLowerBound;
    for (let i = symbols.length - 1; i >= 0; i--) {
        const symbol = symbols[i];
        const model = modelIndexes === undefined ? 0 : modelIndexes[i];
        const frequency = models[model][symbol];
        const maximum = Math.floor(ransLowerBound / scale) * 256 * frequency;
        while (state >= maximum) {
            renormalized.push(state % 256);
            state = Math.floor(state / 256);
        }
        state =
            Math.floor(state / frequency) * scale +
            (state % frequency) +
            cumulative[model][symbol];
    }
    return Uint8Array.of(
        state & 0xff,
        Math.floor(state / 256) & 0xff,
        Math.floor(state / 65536) & 0xff,
        Math.floor(state / 16777216) & 0xff,
        ...renormalized.reverse(),
    );
}

function encodeChain(chain) {
    const rows = extractRows(chain);
    const { codes, probabilities } = quantizeProbabilities(rows);
    const histograms = makeColumnHistograms(codes);
    const clustered = clusterHistograms(histograms);
    const dataModels = clustered.modelCounts.map(normalizeCounts);
    const modelIdCounts = new Uint32Array(entropyModelCount);
    for (const model of clustered.assignments) modelIdCounts[model]++;
    const modelIdModel = normalizeCounts(modelIdCounts);

    const dataSymbols = new Uint8Array(codes.length);
    const dataModelIndexes = new Uint8Array(codes.length);
    let output = 0;
    for (let second = 0; second < alphabetSize; second++) {
        for (let character = 0; character < alphabetSize; character++) {
            const column = second * alphabetSize + character;
            const model = clustered.assignments[column];
            for (let first = 0; first < alphabetSize; first++) {
                dataSymbols[output] =
                    codes[
                        (first * alphabetSize + second) * alphabetSize +
                            character
                    ];
                dataModelIndexes[output] = model;
                output++;
            }
        }
    }

    const modelStream = encodeRans(clustered.assignments, undefined, [
        modelIdModel,
    ]);
    const dataStream = encodeRans(dataSymbols, dataModelIndexes, dataModels);
    const headerSize =
        4 +
        probabilityLevelCount * 4 +
        entropyModelCount * probabilityLevelCount * 2 +
        (entropyModelCount - 1) * 2 +
        4;
    const bytes = new Uint8Array(
        headerSize + modelStream.length + dataStream.length,
    );
    const view = new DataView(bytes.buffer);
    let offset = 0;
    bytes[offset++] = probabilityLevelCount;
    bytes[offset++] = entropyModelCount;
    bytes[offset++] = scaleBits;
    bytes[offset++] = 0;
    for (const probability of probabilities) {
        view.setFloat32(offset, probability, true);
        offset += 4;
    }
    for (const model of dataModels) {
        for (let symbol = 0; symbol < probabilityLevelCount; symbol++) {
            view.setUint16(offset, model[symbol], true);
            offset += 2;
        }
    }
    for (let model = 0; model < entropyModelCount - 1; model++) {
        view.setUint16(offset, modelIdModel[model], true);
        offset += 2;
    }
    view.setUint32(offset, modelStream.length, true);
    offset += 4;
    bytes.set(modelStream, offset);
    offset += modelStream.length;
    bytes.set(dataStream, offset);
    return bytes;
}

function encodeBase91(bytes) {
    let result = "";
    let bits = 0;
    let bitCount = 0;
    for (const byte of bytes) {
        bits |= byte << bitCount;
        bitCount += 8;
        if (bitCount <= 13) continue;

        let value = bits & 8191;
        if (value > 88) {
            bits >>= 13;
            bitCount -= 13;
        } else {
            value = bits & 16383;
            bits >>= 14;
            bitCount -= 14;
        }
        result +=
            base91Alphabet[value % 91] + base91Alphabet[Math.floor(value / 91)];
    }
    if (bitCount !== 0) {
        result += base91Alphabet[bits % 91];
        if (bitCount > 7 || bits > 90) {
            result += base91Alphabet[Math.floor(bits / 91)];
        }
    }
    return result;
}

const [, , inputPath, outputPath] = process.argv;
if (inputPath === undefined || outputPath === undefined) {
    throw new Error(
        "Usage: node script/encode-markov-chain.mjs INPUT.json OUTPUT.ts",
    );
}

const chainData = JSON.parse(readFileSync(inputPath, "utf8"));
const encoded = encodeBase91(encodeChain(chainData));
writeFileSync(
    outputPath,
    `export const encodedMarkovChain =\n    "${encoded}";\n`,
);
