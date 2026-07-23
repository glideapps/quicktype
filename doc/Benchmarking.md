# Pipeline performance benchmark

Run the benchmark from the repository root:

```bash
npm run benchmark:pipeline
```

The command builds `quicktype-core`, warms up every case, and reports median,
p95, and minimum end-to-end times plus maximum observed used heap.  It covers
small and large JSON samples, small and large JSON Schemas, and the TypeScript
and Rust renderers.  Inputs are generated deterministically in memory so
results do not include filesystem I/O.

## Canonical real-world benchmark

Run the canonical benchmark set with:

```bash
npm run benchmark:canonical
```

This command builds `quicktype-core`, gives Node an 8 GiB heap, and runs one
warmup plus three measured passes for both TypeScript and Rust over exactly
these inputs:

- USGS all-month earthquakes GeoJSON
- GitHub REST OpenAPI description
- NVD CVE 2024 feed
- HL7 FHIR R5 combined JSON Schema
- Kestra 0.19 JSON Schema

The inputs are downloaded on the first run and cached outside the repository in
the operating system's user cache directory.  Downloads, decompression, and
filesystem reads are not timed.  Repeated runs use the same snapshots; download
current copies with:

```bash
npm run benchmark:canonical -- --refresh
```

Set `QUICKTYPE_BENCHMARK_CACHE` or pass `--cache-dir DIR` to choose a different
cache location.  The canonical command accepts the same `--warmup`,
`--iterations`, and `--json` options as the synthetic pipeline benchmark.

The end-to-end timer begins before quicktype parses or registers the input and
ends after the generated source has been serialized.  The phase breakdown is:

- **Parse**: compressed JSON parsing for JSON samples, or YAML/JSON parsing for
  JSON Schema.
- **Infer/schema**: type inference from compressed JSON, or conversion from the
  parsed schema to quicktype's initial type graph.
- **Transform**: graph rewrites, map and enum inference, transformations,
  garbage collection, and name gathering.
- **Codegen**: target-language rendering and serialization.
- **Other**: input setup, graph setup, callback overhead, and uninstrumented
  control flow.

The phase breakdown uses the run at the median end-to-end time.  When the
iteration count is even, the two middle runs are interpolated.  This keeps the
phases additive and their percentages at 100%.

Individual pass timings are also printed.  Pass timings are inclusive, and
repeated passes such as `flatten unions` are combined within each run.

`Max heap` is the largest `process.memoryUsage().heapUsed` value observed across
the measured runs for a case.  Heap is sampled before and after input parsing,
after every instrumented quicktype pass, after rendering, and after output
serialization.  Node does not expose an exact JavaScript-heap high-water mark,
so allocations created and released entirely within one synchronous pass might
not appear in this value.  The JSON output records it as
`memory.maximumHeapUsedBytes`.

Use fewer samples for a quick smoke test or emit JSON for comparison tooling:

```bash
npm run benchmark:pipeline -- --warmup 0 --iterations 1
npm run benchmark:pipeline -- --iterations 10 --json > benchmark.json
```

For less garbage-collection noise, invoke the built benchmark directly with
Node's explicit GC enabled:

```bash
npm run build --workspace quicktype-core
node --expose-gc script/benchmark-pipeline.mjs
```

Compare results only on the same machine, Node version, power mode, and command
line.  The benchmark intentionally reports distributions rather than enforcing
a fixed pass/fail threshold.
