# Class-width benchmark (issue #559)

Manual for reproducing the Rust measurement used to answer
[#559](https://github.com/glideapps/quicktype/issues/559) — see `RESULTS.md`
for the write-up. This benchmark only concerns Rust; it's the toolchain the
issue names and the one CI actually compiles (`.github/workflows/test-pr.yaml`,
`fixture: rust,schema-rust`).

## What it's testing

#559 claims `blns-object.json` and `keyword-unions.schema` have objects big
enough to slow down Rust compilation. The claimed mechanism: serde's
`#[derive(Deserialize)]` expands an N-field struct into one `visit_map`
function with N locals, an N-arm match, and N missing-field checks — cost
concentrated in one function, not spread across the file.

To test that, candidates are built holding the **same keys spread across more,
narrower classes** — identical total field count, so a linear cost model
predicts identical compile times. Any drop would be the superlinear part the
issue is about. `n=1` is a control: same grouping as the checked-in file, so it
must reproduce today's numbers or the harness is wrong.

## Requirements

```bash
npm run build                              # need dist/index.js
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # if cargo isn't installed
export PATH="$HOME/.cargo/bin:$PATH"       # rustup installs here, not on PATH by default
```

Run everything from the repo root. Nothing here writes into the repo — all
candidates and build artifacts live under `$BENCH`, a scratch directory:

```bash
export BENCH=/tmp/bench          # or wherever you like
mkdir -p $BENCH/inputs
B=script/benchmark-class-width
```

## 1. Build candidates

Same keys, increasingly narrow classes:

```bash
for n in 1 2 4 8;  do python3 $B/reshape-blns.py $n           > $BENCH/inputs/blns-$n.json;  done
for n in 1 2 5 10; do python3 $B/reshape-keyword-unions.py $n > $BENCH/inputs/ku-$n.schema; done
```

## 2. Tier 0 — structural check (no toolchain, ~5 seconds)

Confirms the candidates isolate the right variable: total code volume should
stay roughly flat while the widest class drops sharply.

```bash
python3 $B/measure.py --lang rust --src-lang json   $BENCH/inputs/blns-{1,2,4,8}.json
python3 $B/measure.py --lang rust --src-lang schema $BENCH/inputs/ku-{1,2,5,10}.schema
```

Reference output:

```
candidate                  lines   types  widest  widest type
--------------------------------------------------------------------
blns-1.json                 1776       4     230  A
blns-2.json                 1801       7     116  A2
blns-4.json                 1844      13      59  A4
blns-8.json                 1941      25      30  A2

candidate                  lines   types  widest  widest type
--------------------------------------------------------------------
ku-1.schema                 3952     554     276  Group1
ku-2.schema                 3957     555     138  Group1
ku-5.schema                 3972     558      56  Group5
ku-10.schema                3997     563      28  Group10
```

Lines move under 10% while widest class drops 8-10×.

## 3. Tier 1 — the actual timing

```bash
REPS=10 bash $B/bench-rust.sh --src-lang json   $BENCH/inputs/blns-{1,2,4,8}.json
REPS=10 bash $B/bench-rust.sh --src-lang schema $BENCH/inputs/ku-{1,2,5,10}.schema
```

`bench-rust.sh` pins a shared `CARGO_TARGET_DIR` and does a throwaway warm-up
build first, so serde compiles once and every timed build recompiles only the
crate under test. Without that, the per-sample serde rebuild the real fixture
harness pays (~8s) would swamp the ~1-2s signal being measured. `touch` before
each build forces a genuine recompile. If a build fails, the script aborts
loudly rather than reporting a fast, meaningless number — a failed compile
looks like a great result if you don't check for it.

`REPS=10` takes ~15-25s per candidate; use `REPS=3` for a quick check, `REPS=10`
for a number worth quoting — single-digit rep counts on the `ku` schema were
noisy enough in early runs to be misleading.

Reference output:

```
candidate                widest    lines   median_s
------------------------------------------------------
blns-1.json                 230     1776       0.73
blns-2.json                 116     1801       0.74
blns-4.json                  59     1844       0.78
blns-8.json                  30     1941       0.82

candidate                widest    lines   median_s
------------------------------------------------------
ku-1.schema                 276     3952       1.98
ku-2.schema                 138     3957       1.97
ku-5.schema                  56     3972       2.00
ku-10.schema                 28     3997       2.02
```

## Reading the result

- **Steep drop as width falls** → the premise holds.
- **Flat, or a slight rise** → the premise doesn't hold on this rustc.

Measured outcome: flat on `ku`, and `blns` gets **monotonically slower** as
classes narrow (0.73s → 0.82s, +12%) — more types cost more than the wide
struct saves. See `RESULTS.md` for the full write-up and what's worth doing
instead.

## Troubleshooting

- `cargo not found` → `export PATH="$HOME/.cargo/bin:$PATH"` (not persisted by
  the rustup install used here).
- Glob like `$BENCH/inputs/ku-{1,2,5,10}.schema` passed through literally →
  `$BENCH` isn't set in this shell, or step 1 wasn't run in it, so the files
  don't exist and the brace expansion has nothing to match.
- `BUILD FAILED for ... -- timings would be meaningless` → the script caught a
  real compile error; the tail of `rustc`'s output is printed above the
  message.
