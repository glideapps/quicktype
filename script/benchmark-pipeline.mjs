#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import {
    InputData,
    JSONSchemaInput,
    jsonInputForTargetLanguage,
    quicktype,
} from "../packages/quicktype-core/dist/index.js";

const DEFAULT_ITERATIONS = 5;
const DEFAULT_WARMUPS = 1;
const LARGE_JSON_RECORDS = 5_000;
const LARGE_SCHEMA_TYPES = 180;
const languages = ["typescript", "rust"];

const canonicalInputDefinitions = [
    {
        filename: "usgs-month.geojson",
        kind: "json",
        minimumBytes: 500_000,
        name: "USGS earthquakes",
        url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson",
    },
    {
        filename: "github-openapi.json",
        kind: "json",
        minimumBytes: 5_000_000,
        name: "GitHub REST OpenAPI",
        url: "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json",
    },
    {
        compression: "gzip",
        filename: "nvd-2024.json",
        kind: "json",
        minimumBytes: 100_000_000,
        name: "NVD CVE 2024",
        url: "https://nvd.nist.gov/feeds/json/cve/2.0/nvdcve-2.0-2024.json.gz",
    },
    {
        filename: "fhir.schema.json",
        kind: "schema",
        minimumBytes: 3_000_000,
        name: "HL7 FHIR R5",
        url: "https://hl7.org/fhir/R5/fhir.schema.json",
    },
    {
        filename: "kestra.schema.json",
        kind: "schema",
        minimumBytes: 5_000_000,
        name: "Kestra 0.19",
        url: "https://hostr.flingit.run/s/quicktype-repros/kestra-0.19.0.schema.json",
    },
];

function defaultCacheDirectory() {
    const platformCache =
        process.platform === "win32"
            ? process.env.LOCALAPPDATA
            : (process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"));
    return join(platformCache ?? tmpdir(), "quicktype", "canonical-benchmark");
}

function usage() {
    console.log(`Usage: npm run benchmark:pipeline -- [options]

Options:
  --iterations N  Measured runs per case (default: ${DEFAULT_ITERATIONS})
  --warmup N      Warmup runs per case (default: ${DEFAULT_WARMUPS})
  --canonical     Run the five canonical real-world inputs
  --cache-dir DIR Cache canonical inputs in DIR
  --refresh       Download fresh canonical input snapshots
  --json          Emit machine-readable JSON instead of tables
  --help          Show this help
`);
}

function positiveInteger(value, option) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new Error(`${option} must be a positive integer`);
    }
    return parsed;
}

function nonnegativeInteger(value, option) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new Error(`${option} must be a nonnegative integer`);
    }
    return parsed;
}

function parseArguments(args) {
    const options = {
        cacheDirectory:
            process.env.QUICKTYPE_BENCHMARK_CACHE ?? defaultCacheDirectory(),
        canonical: false,
        iterations: DEFAULT_ITERATIONS,
        json: false,
        refresh: false,
        warmups: DEFAULT_WARMUPS,
    };

    let i = 0;
    while (i < args.length) {
        const argument = args[i];
        switch (argument) {
            case "--iterations":
                options.iterations = positiveInteger(
                    args[i + 1],
                    "--iterations",
                );
                i += 2;
                break;
            case "--warmup":
                options.warmups = nonnegativeInteger(args[i + 1], "--warmup");
                i += 2;
                break;
            case "--json":
                options.json = true;
                i++;
                break;
            case "--canonical":
                options.canonical = true;
                i++;
                break;
            case "--cache-dir":
                if (args[i + 1] === undefined) {
                    throw new Error("--cache-dir requires a directory");
                }
                options.cacheDirectory = args[i + 1];
                i += 2;
                break;
            case "--refresh":
                options.refresh = true;
                i++;
                break;
            case "--help":
                usage();
                process.exit(0);
                break;
            default:
                throw new Error(`Unknown option: ${argument}`);
        }
    }

    return options;
}

function makeRecord(index) {
    const record = {
        id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
        createdAt: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
        status: ["queued", "running", "complete", "failed"][index % 4],
        score: index % 7 === 0 ? index + 0.25 : index,
        tags: [`group-${index % 20}`, `region-${index % 8}`],
        owner: {
            id: index % 100,
            name: `Owner ${index % 100}`,
            profile: `https://example.com/owners/${index % 100}`,
        },
        metrics: {
            attempts: index % 5,
            durationMs: index * 3.5,
            successful: index % 9 !== 0,
        },
    };

    if (index % 3 === 0) {
        record.note = `Generated benchmark record ${index}`;
    }
    if (index % 5 === 0) {
        record.metadata = { source: "benchmark", shard: index % 16 };
    }

    return record;
}

function makeJSON(recordCount) {
    return JSON.stringify({
        generatedAt: "2026-01-01T00:00:00Z",
        records: Array.from({ length: recordCount }, (_, index) =>
            makeRecord(index),
        ),
    });
}

function makeEntitySchema(index) {
    const properties = {
        id: { format: "uuid", type: "string" },
        createdAt: { format: "date-time", type: "string" },
        status: {
            enum: ["queued", "running", "complete", "failed"],
            type: "string",
        },
        score: { minimum: 0, type: "number" },
        tags: { items: { type: "string" }, type: "array" },
        metadata: {
            additionalProperties: { type: "string" },
            type: "object",
        },
    };

    if (index > 0) {
        properties.parent = { $ref: `#/definitions/Entity${index - 1}` };
    }

    return {
        additionalProperties: false,
        properties,
        required: ["id", "createdAt", "status", "score", "tags"],
        title: `Entity ${index}`,
        type: "object",
    };
}

function makeSchema(typeCount) {
    const definitions = Object.fromEntries(
        Array.from({ length: typeCount }, (_, index) => [
            `Entity${index}`,
            makeEntitySchema(index),
        ]),
    );
    const properties = Object.fromEntries(
        Array.from({ length: typeCount }, (_, index) => [
            `entity${index}`,
            { $ref: `#/definitions/Entity${index}` },
        ]),
    );

    return JSON.stringify({
        $schema: "http://json-schema.org/draft-07/schema#",
        additionalProperties: false,
        definitions,
        properties,
        required: Object.keys(properties),
        title: "Benchmark",
        type: "object",
    });
}

const inputs = [
    { kind: "json", size: "small", source: makeJSON(4) },
    { kind: "json", size: "large", source: makeJSON(LARGE_JSON_RECORDS) },
    { kind: "schema", size: "small", source: makeSchema(3) },
    { kind: "schema", size: "large", source: makeSchema(LARGE_SCHEMA_TYPES) },
];

async function cachedInputIsUsable(filename, minimumBytes) {
    try {
        return (await stat(filename)).size >= minimumBytes;
    } catch (error) {
        if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
        ) {
            return false;
        }
        throw error;
    }
}

async function downloadCanonicalInput(definition, filename) {
    console.error(`Downloading ${definition.name} from ${definition.url}`);
    const response = await fetch(definition.url, {
        headers: { "user-agent": "quicktype-canonical-benchmark" },
    });
    if (!response.ok || response.body === null) {
        throw new Error(
            `Could not download ${definition.name}: HTTP ${response.status}`,
        );
    }

    const temporaryFilename = `${filename}.${process.pid}.tmp`;
    await rm(temporaryFilename, { force: true });
    try {
        const transforms =
            definition.compression === "gzip" ? [createGunzip()] : [];
        await pipeline(
            Readable.fromWeb(response.body),
            ...transforms,
            createWriteStream(temporaryFilename),
        );
        if (
            !(await cachedInputIsUsable(
                temporaryFilename,
                definition.minimumBytes,
            ))
        ) {
            throw new Error(
                `Downloaded ${definition.name} is unexpectedly small`,
            );
        }
        await rm(filename, { force: true });
        await rename(temporaryFilename, filename);
    } catch (error) {
        await rm(temporaryFilename, { force: true });
        throw error;
    }
}

async function loadCanonicalInput(definition, options) {
    await mkdir(options.cacheDirectory, { recursive: true });
    const filename = join(options.cacheDirectory, definition.filename);
    if (
        options.refresh ||
        !(await cachedInputIsUsable(filename, definition.minimumBytes))
    ) {
        await downloadCanonicalInput(definition, filename);
    } else {
        console.error(`Using cached ${definition.name}: ${filename}`);
    }

    return {
        kind: definition.kind,
        name: definition.name,
        size: "canonical",
        source: await readFile(filename, "utf8"),
        sourceURL: definition.url,
    };
}

function sumEvents(events, name) {
    return events
        .filter((event) => event.name === name)
        .reduce((sum, event) => sum + event.milliseconds, 0);
}

async function runOnce(input, language) {
    const events = [];
    const inputData = new InputData();
    const started = performance.now();
    let jsonParseMilliseconds = 0;
    let maximumHeapUsedBytes = 0;
    const observeHeap = () => {
        maximumHeapUsedBytes = Math.max(
            maximumHeapUsedBytes,
            process.memoryUsage().heapUsed,
        );
    };

    observeHeap();

    if (input.kind === "json") {
        const jsonInput = jsonInputForTargetLanguage(language);
        const parseStarted = performance.now();
        await jsonInput.addSource({
            name: "Benchmark",
            samples: [input.source],
        });
        jsonParseMilliseconds = performance.now() - parseStarted;
        inputData.addInput(jsonInput);
        observeHeap();
    } else {
        const schemaInput = new JSONSchemaInput(undefined);
        await schemaInput.addSource({
            name: "Benchmark",
            schema: input.source,
        });
        inputData.addInput(schemaInput);
    }

    const output = await quicktype({
        inputData,
        lang: language,
        onTiming: (timing) => {
            events.push(timing);
            observeHeap();
        },
    });
    observeHeap();
    const totalMilliseconds = performance.now() - started;
    const schemaParseMilliseconds = sumEvents(events, "parse JSON Schema");
    const readInputMilliseconds = sumEvents(events, "read input");
    const renderMilliseconds = sumEvents(events, "render");
    const transformationMilliseconds = events
        .filter(
            (event) =>
                event.name !== "read input" &&
                event.name !== "render" &&
                event.name !== "parse JSON Schema" &&
                !event.name.startsWith("  "),
        )
        .reduce((sum, event) => sum + event.milliseconds, 0);
    const parsingMilliseconds =
        input.kind === "json" ? jsonParseMilliseconds : schemaParseMilliseconds;
    const inferenceMilliseconds = Math.max(
        0,
        readInputMilliseconds - schemaParseMilliseconds,
    );
    const accountedMilliseconds =
        parsingMilliseconds +
        inferenceMilliseconds +
        transformationMilliseconds +
        renderMilliseconds;

    const passes = new Map();
    if (input.kind === "json") {
        passes.set("parse JSON input", jsonParseMilliseconds);
    }
    for (const event of events) {
        passes.set(
            event.name,
            (passes.get(event.name) ?? 0) + event.milliseconds,
        );
    }

    const serializedOutput = output.lines.join("\n");
    const outputBytes = Buffer.byteLength(serializedOutput);
    observeHeap();

    return {
        maximumHeapUsedBytes,
        outputBytes,
        passes: Object.fromEntries(passes),
        phases: {
            codeGeneration: renderMilliseconds,
            inference: inferenceMilliseconds,
            other: Math.max(0, totalMilliseconds - accountedMilliseconds),
            parsing: parsingMilliseconds,
            transformations: transformationMilliseconds,
        },
        totalMilliseconds,
    };
}

function percentile(values, percentileValue) {
    const sorted = values.toSorted((a, b) => a - b);
    const index = Math.max(
        0,
        Math.ceil((percentileValue / 100) * sorted.length) - 1,
    );
    return sorted[index];
}

function median(values) {
    const sorted = values.toSorted((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

function summarizeSamples(input, language, samples) {
    const totalValues = samples.map((sample) => sample.totalMilliseconds);
    const samplesByTotal = samples.toSorted(
        (left, right) => left.totalMilliseconds - right.totalMilliseconds,
    );
    const middle = Math.floor(samplesByTotal.length / 2);
    const phaseNames = Object.keys(samples[0].phases);
    const passNames = new Set(
        samples.flatMap((sample) => Object.keys(sample.passes)),
    );
    const phases = Object.fromEntries(
        phaseNames.map((name) => {
            const milliseconds =
                samplesByTotal.length % 2 === 0
                    ? (samplesByTotal[middle - 1].phases[name] +
                          samplesByTotal[middle].phases[name]) /
                      2
                    : samplesByTotal[middle].phases[name];
            return [name, milliseconds];
        }),
    );
    const passes = Object.fromEntries(
        Array.from(passNames, (name) => [
            name,
            median(samples.map((sample) => sample.passes[name] ?? 0)),
        ]),
    );

    return {
        case: `${input.name ?? `${input.kind}/${input.size}`}/${language}`,
        input: {
            bytes: Buffer.byteLength(input.source),
            kind: input.kind,
            name: input.name,
            size: input.size,
            sourceURL: input.sourceURL,
        },
        language,
        memory: {
            maximumHeapUsedBytes: Math.max(
                ...samples.map((sample) => sample.maximumHeapUsedBytes),
            ),
        },
        outputBytes: median(samples.map((sample) => sample.outputBytes)),
        passes,
        phases,
        total: {
            medianMilliseconds: median(totalValues),
            minMilliseconds: Math.min(...totalValues),
            p95Milliseconds: percentile(totalValues, 95),
        },
    };
}

function formatBytes(bytes) {
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MiB`;
    if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`;
    return `${bytes} B`;
}

function formatMilliseconds(milliseconds) {
    if (milliseconds >= 100) return milliseconds.toFixed(1);
    if (milliseconds >= 10) return milliseconds.toFixed(2);
    return milliseconds.toFixed(3);
}

function table(headers, rows) {
    const widths = headers.map((header, index) =>
        Math.max(header.length, ...rows.map((row) => row[index].length)),
    );
    const formatRow = (row) =>
        row.map((cell, index) => cell.padEnd(widths[index])).join("  ");
    return [
        formatRow(headers),
        formatRow(widths.map((width) => "-".repeat(width))),
        ...rows.map(formatRow),
    ].join("\n");
}

function phaseCell(result, phase) {
    const milliseconds = result.phases[phase];
    const percent = (milliseconds / result.total.medianMilliseconds) * 100;
    return `${formatMilliseconds(milliseconds)} (${percent.toFixed(0)}%)`;
}

function printResults(results, options) {
    console.log(
        `quicktype ${options.canonical ? "canonical " : ""}pipeline benchmark (${process.version}, ${process.platform}/${process.arch})`,
    );
    console.log(
        `${options.iterations} measured run(s), ${options.warmups} warmup(s) per case`,
    );
    console.log("");
    console.log("End-to-end results (milliseconds)");
    console.log(
        table(
            ["Case", "Input", "Output", "Max heap", "Median", "p95", "Min"],
            results.map((result) => [
                result.case,
                formatBytes(result.input.bytes),
                formatBytes(result.outputBytes),
                formatBytes(result.memory.maximumHeapUsedBytes),
                formatMilliseconds(result.total.medianMilliseconds),
                formatMilliseconds(result.total.p95Milliseconds),
                formatMilliseconds(result.total.minMilliseconds),
            ]),
        ),
    );
    console.log("");
    console.log("Phase breakdown at median end-to-end time: milliseconds (%)");
    console.log(
        table(
            ["Case", "Parse", "Infer/schema", "Transform", "Codegen", "Other"],
            results.map((result) => [
                result.case,
                phaseCell(result, "parsing"),
                phaseCell(result, "inference"),
                phaseCell(result, "transformations"),
                phaseCell(result, "codeGeneration"),
                phaseCell(result, "other"),
            ]),
        ),
    );
    console.log("");
    console.log("Hottest measured passes (median, inclusive)");
    for (const result of results) {
        const hottest = Object.entries(result.passes)
            .toSorted((left, right) => right[1] - left[1])
            .slice(0, 4)
            .map(
                ([name, milliseconds]) =>
                    `${name} ${formatMilliseconds(milliseconds)} ms`,
            )
            .join(", ");
        console.log(`  ${result.case}: ${hottest}`);
    }
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const results = [];
    const selectedInputs = options.canonical
        ? canonicalInputDefinitions
        : inputs;

    for (const selectedInput of selectedInputs) {
        const input = options.canonical
            ? await loadCanonicalInput(selectedInput, options)
            : selectedInput;
        for (const language of languages) {
            globalThis.gc?.();
            if (options.canonical) {
                console.error(`Benchmarking ${input.name} -> ${language}`);
            }
            for (let i = 0; i < options.warmups; i++) {
                await runOnce(input, language);
            }

            const samples = [];
            for (let i = 0; i < options.iterations; i++) {
                globalThis.gc?.();
                samples.push(await runOnce(input, language));
            }
            results.push(summarizeSamples(input, language, samples));
        }
        if (options.canonical) {
            input.source = "";
            globalThis.gc?.();
        }
    }

    if (options.json) {
        console.log(
            JSON.stringify(
                {
                    config: {
                        cacheDirectory: options.canonical
                            ? options.cacheDirectory
                            : undefined,
                        iterations: options.iterations,
                        largeJSONRecords: LARGE_JSON_RECORDS,
                        largeSchemaTypes: LARGE_SCHEMA_TYPES,
                        suite: options.canonical ? "canonical" : "synthetic",
                        warmups: options.warmups,
                    },
                    platform: {
                        arch: process.arch,
                        node: process.version,
                        os: process.platform,
                    },
                    results,
                },
                undefined,
                2,
            ),
        );
    } else {
        printResults(results, options);
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
