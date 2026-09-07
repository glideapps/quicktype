# Issue #559 — measured on Rust, and the premise doesn't hold

**Recommendation: close #559 as obsolete.** Narrowing the widest generated Rust
struct by 8-10× produces no compile-time improvement. If anything, it's
slightly slower.

Measured 2026-08-12/13, macOS / Apple Silicon, rustc + cargo 1.97.1.

## The claim under test

#559 says `blns-object.json`, `keywords.json`, and `keyword-unions.schema` have
objects big enough to slow down compilation, "particularly Rust." It comes from
[#516](https://github.com/glideapps/quicktype/issues/516), where profiling with
`cargo-expand` and `-Ztime-passes` found 40k expanded lines, 30k in a single
method, dominated by rustc's `translation` pass.

The claimed mechanism: for an N-field struct, serde's `#[derive(Deserialize)]`
expands into one `visit_map` function with N locals, an N-arm match, and N
missing-field checks. Cost concentrates in **one function**, not spread across
the file. Rust is the language actually named, the only one profiled in #516,
and the only one this repo's CI compiles for these fixtures
(`.github/workflows/test-pr.yaml`, `fixture: rust,schema-rust`) — so it's the
toolchain this benchmark measures directly rather than by inference.

## Method

Candidates hold the same keys spread across more, narrower classes — **identical
total field count**, so a linear cost model predicts identical compile times.
Any drop would be the superlinear component the issue describes.

| candidate | lines | types | widest class |
|---|---|---|---|
| `blns-1` *(= the checked-in file)* | 1,776 | 4 | **230** |
| `blns-2` | 1,801 | 7 | 116 |
| `blns-4` | 1,844 | 13 | 59 |
| `blns-8` | 1,941 | 25 | 30 |

| candidate | lines | types | widest class |
|---|---|---|---|
| `ku-1` *(≈ the checked-in file)* | 3,952 | 554 | **276** |
| `ku-2` | 3,957 | 555 | 138 |
| `ku-5` | 3,972 | 558 | 56 |
| `ku-10` | 3,997 | 563 | 28 |

Total lines move under 10% in both cases while the widest class drops 8-10×.
Three guards: `n=1` is a control that must reproduce the checked-in file (it
does); every candidate is asserted lossless (identical key/value multiset); and
`bench-rust.sh` aborts if a build fails, since a failed build is fast and would
otherwise fake a win.

**What's timed:** `cargo build` only — compile time, not `cargo run`, not the
JSON round-trip. serde is prebuilt once in a shared `CARGO_TARGET_DIR`, so each
timed build recompiles only `module_under_test.rs`. This isolates the specific
thing #559 is about (rustc compiling a wide struct), separate from the
per-sample fixture overhead covered below.

## Results

Median of 10 builds per candidate:

| widest class | `blns` compile | `keyword-unions` compile |
|---|---|---|
| 276 / 230 *(control)* | 0.73s | 1.98s |
| 138 / 116 | 0.74s | 1.97s |
| 56 / 59 | 0.78s | 2.00s |
| 28 / 30 | **0.82s** | 2.02s |

`keyword-unions` is flat to within 3%. `blns` is **monotonically slower** as
classes narrow — 0.73s → 0.82s, +12% — tracking the 9% growth in emitted lines:
splitting one wide struct into several narrow ones adds more code than it
removes cost. Neither result supports the issue's premise on the toolchain it
actually names.

rustc has also changed substantially since the 2018 profile (rustc ~1.24 era);
whatever superlinear cost `-Ztime-passes` found in `translation` back then does
not reproduce on 1.97.

## Where fixture time actually goes

For context on the ~9% number below and why it matters:

```
one rust sample through the harness:  8,656 ms
of which the crate compile is:          790 ms   (9%)
```

The other ~91% is dependency compilation: `fixtures.ts:281` copies
`test/fixtures/rust` into a fresh directory per sample, `RustLanguage` has no
`setupCommand`, and no `CARGO_TARGET_DIR` is set anywhere in the repo, so cargo
rebuilds serde/serde_derive/serde_json from scratch every time.

Two things follow from this, and they cut in opposite directions from #559:

- Splitting `blns-object.json` into 4 files, as #559 suggests, adds 3 more
  samples — roughly 3 × 8.66s ≈ **26 seconds** per Rust JSON run — for a
  compile-time change measured at ±0.1s. That's a net loss.
- The 91% figure suggests the real lever is elsewhere: **setting a shared
  `CARGO_TARGET_DIR` for the Rust fixture is worth investigating separately.**
  This is a plausible optimization based on where the time currently goes in a
  single measured sample, not something this benchmark proves out end-to-end.
  It wasn't tested against the full 52-sample suite, doesn't account for cache
  contention if the harness's forked workers (`test/lib/multicore.ts`) write to
  the same target directory concurrently, and CI's cold-start-per-job model may
  behave differently than this local, warm-cache measurement. Worth a
  follow-up spike, not a claimed fix.

## Scope of the evidence

This result is Rust-only, deliberately — see "The claim under test" above for
why that's the toolchain that matters for #559. Two earlier passes on other
toolchains (C++/g++ and Swift/swiftc, both also flat) and a discussion of
JVM/C# coverage are not reproduced here; ask if that's wanted for a broader
writeup.

## Worth doing instead

**1. Python cannot run `keyword-unions.schema` at all.** It generates a
`KeywordUnions(...)` call with **276 arguments**, past CPython's 255 limit —
hence `test/languages.ts:336`:

```ts
skipSchema: [
    "keyword-unions.schema", // Requires more than 255 arguments
],
```

Grouping that schema's properties would let Python run it. This is the one
surviving reason to reshape a fixture, and it is a **coverage** fix, not a
performance one — independent of everything above.

**2. `keywords.json` has drifted from its generator.** It contains three
keywords absent from `test/keywords.txt` — `clone`, `equalityContract`,
`printMembers` (C# record members, hand-inserted). `keyword-unions.schema` and
`keyword-enum.schema` both regenerate byte-identically; `keywords.json` does
not. **Running `test/make-keyword-tests.sh` today silently deletes that
coverage.** Unrelated to #559; worth its own fix.

## Reproducing

See `README.md` in this directory. Everything runs from a scratch `$BENCH`
directory; no repo files are modified.
