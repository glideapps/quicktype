#!/usr/bin/env node

import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";

import { buildSync } from "esbuild";
import { encodedMarkovChain } from "../packages/quicktype-core/dist/EncodedMarkovChain.js";
import { evaluate, load } from "../packages/quicktype-core/dist/MarkovChain.js";

const decodeSamples = 20;
const heapCopies = 50;
const inferencePasses = 100_000;
const propertyNames = [
    "id",
    "userId",
    "createdAt",
    "updated_at",
    "displayName",
    "contactInformation",
    "organization",
    "postingFrequency",
    "latitude",
    "longitude",
    "https://example.com/resource/123",
    "550e8400-e29b-41d4-a716-446655440000",
    "0uBTNdNGb2OY5lou41iYL52LcDq2",
    "-KpqHmWuDOUnr1hmAhxp",
    "189512",
];

if (globalThis.gc === undefined) {
    throw new Error(
        "This benchmark requires --expose-gc. Run `npm run benchmark:markov-chain`.",
    );
}

function collectGarbage() {
    // Several passes make the retained-heap measurement more stable across V8
    // versions and generations.
    for (let i = 0; i < 5; i++) {
        globalThis.gc();
    }
}

function median(values) {
    const sorted = values.toSorted((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

function measureHeap() {
    // Warm up pako and JSON.parse so their one-time allocations are not
    // attributed to the Markov chain object.
    load();
    collectGarbage();

    const before = process.memoryUsage();
    const chains = Array.from({ length: heapCopies }, () => load());
    collectGarbage();
    const after = process.memoryUsage();

    // Keep the objects observably alive until after the second measurement.
    const checksum = chains.reduce((sum, chain) => sum + chain.depth, 0);
    const heapBytes = (after.heapUsed - before.heapUsed) / heapCopies;
    const arrayBufferBytes =
        (after.arrayBuffers - before.arrayBuffers) / heapCopies;
    return {
        heapBytes,
        arrayBufferBytes,
        retainedBytes: heapBytes + arrayBufferBytes,
        checksum,
    };
}

function benchmarkDecode() {
    const timings = [];
    let checksum = 0;

    for (let i = 0; i < 3; i++) {
        checksum += load().depth;
    }

    for (let i = 0; i < decodeSamples; i++) {
        collectGarbage();
        const start = performance.now();
        const chain = load();
        timings.push(performance.now() - start);
        checksum += chain.depth;
    }

    return { milliseconds: median(timings), checksum };
}

function benchmarkInference() {
    const chain = load();
    let checksum = 0;

    // Warm up evaluate() before timing it.
    for (let pass = 0; pass < 10_000; pass++) {
        for (const name of propertyNames) {
            checksum += evaluate(chain, name);
        }
    }

    const evaluations = inferencePasses * propertyNames.length;
    const start = performance.now();
    for (let pass = 0; pass < inferencePasses; pass++) {
        for (const name of propertyNames) {
            checksum += evaluate(chain, name);
        }
    }
    const milliseconds = performance.now() - start;

    return {
        evaluations,
        milliseconds,
        evaluationsPerSecond: evaluations / (milliseconds / 1000),
        nanosecondsPerEvaluation: (milliseconds * 1_000_000) / evaluations,
        checksum,
    };
}

function formatBytes(bytes) {
    return `${Math.round(bytes).toLocaleString("en-US")} bytes (${(bytes / 1_048_576).toFixed(2)} MiB)`;
}

const bundle = buildSync({
    stdin: {
        contents:
            'export { load, evaluate } from "./packages/quicktype-core/src/MarkovChain.ts";',
        resolveDir: process.cwd(),
        sourcefile: "markov-entry.ts",
        loader: "ts",
    },
    bundle: true,
    minify: true,
    platform: "browser",
    format: "esm",
    write: false,
    treeShaking: true,
}).outputFiles[0].contents;
const heap = measureHeap();
const decode = benchmarkDecode();
const inference = benchmarkInference();

console.log(
    `Markov chain benchmark (${process.version}, ${process.platform}/${process.arch})`,
);
console.log("");
console.log("Bundled string and decoder");
console.log(
    `  Encoded characters:      ${encodedMarkovChain.length.toLocaleString("en-US")}`,
);
console.log(
    `  UTF-8 bytes:             ${formatBytes(Buffer.byteLength(encodedMarkovChain))}`,
);
console.log(`  Browser bundle:          ${formatBytes(bundle.byteLength)}`);
console.log(
    `  Browser bundle, gzip:    ${formatBytes(gzipSync(bundle, { level: 9 }).byteLength)}`,
);
console.log("");
console.log("Parsed object");
console.log(`  Retained memory:         ${formatBytes(heap.retainedBytes)}`);
console.log(`  V8 heap:                 ${formatBytes(heap.heapBytes)}`);
console.log(`  ArrayBuffer backing:     ${formatBytes(heap.arrayBufferBytes)}`);
console.log(`  Measurement copies:      ${heapCopies}`);
console.log("");
console.log("Base91 + rANS decode");
console.log(
    `  Median:                  ${decode.milliseconds.toFixed(3)} ms (${decodeSamples} samples)`,
);
console.log("");
console.log("Inference (evaluate)");
console.log(
    `  Evaluations:             ${inference.evaluations.toLocaleString("en-US")}`,
);
console.log(
    `  Elapsed:                 ${inference.milliseconds.toFixed(3)} ms`,
);
console.log(
    `  Throughput:              ${Math.round(inference.evaluationsPerSecond).toLocaleString("en-US")} evaluations/s`,
);
console.log(
    `  Time per evaluation:     ${inference.nanosecondsPerEvaluation.toFixed(1)} ns`,
);
console.log("");
console.log(
    `Checksum: ${(heap.checksum + decode.checksum + inference.checksum).toFixed(6)}`,
);
