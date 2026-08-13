#!/usr/bin/env bash
# Tier 1 (canonical -- this is the case issue #559 is about): time the crate
# under test, with serde already built.
#
# The fixture harness copies test/fixtures/rust into a fresh directory per
# sample and there is no CARGO_TARGET_DIR anywhere in the repo, so every sample
# rebuilds serde from scratch.  That fixed cost is large enough to swamp the
# signal we care about, so this script pins a shared target directory and does a
# throwaway warm-up build first -- every timed build then recompiles only
# quick_type_test.
#
# Requires rustup:  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
#
# Usage:  bench-rust.sh --src-lang json $BENCH/inputs/blns-{1,2,4,8}.json
set -euo pipefail

REPS="${REPS:-3}"
SRC_LANG=json
if [ "${1:-}" = "--src-lang" ]; then SRC_LANG="$2"; shift 2; fi

command -v cargo >/dev/null || { echo "cargo not found -- install rustup"; exit 1; }
[ -f dist/index.js ] || { echo "dist/index.js missing -- run npm run build"; exit 1; }

BENCH="${BENCH:-${CLAUDE_JOB_DIR:-/tmp}/bench}"
export CARGO_TARGET_DIR="$BENCH/target"
crate="$BENCH/crate"
mkdir -p "$crate"
cp test/fixtures/rust/Cargo.toml test/fixtures/rust/Cargo.lock test/fixtures/rust/main.rs "$crate/"

build() { (cd "$crate" && cargo build --quiet 2>/dev/null); }

# Warm-up: compiles serde once into the shared target dir.  Timing discarded.
node dist/index.js --lang rust --src-lang "$SRC_LANG" --top-level TopLevel \
    "$1" > "$crate/module_under_test.rs" 2>/dev/null
build || { echo "warm-up build failed"; exit 1; }

printf "%-22s %8s %8s %10s\n" candidate widest lines "median_s"
printf -- "------------------------------------------------------\n"

for input in "$@"; do
    # --top-level matches RustLanguage.topLevel; main.rs imports module_under_test::TopLevel.
    node dist/index.js --lang rust --src-lang "$SRC_LANG" --top-level TopLevel \
        "$input" > "$crate/module_under_test.rs" 2>/dev/null

    widest=$(awk '
        /^pub (struct|enum) / { inb=1; n=0; next }
        inb && /^ +pub / { n++ }
        inb && /^}/ { inb=0; if (n>max) max=n }
        END { print max+0 }' "$crate/module_under_test.rs")
    lines=$(wc -l < "$crate/module_under_test.rs" | tr -d ' ')

    # A failed build is fast, and would look like a great result.  Check once,
    # loudly, before timing anything.
    if ! (cd "$crate" && cargo build --quiet 2>"$crate/build.err"); then
        echo "BUILD FAILED for $(basename "$input") -- timings would be meaningless" >&2
        head -20 "$crate/build.err" >&2
        exit 1
    fi

    times=()
    for _ in $(seq "$REPS"); do
        touch "$crate/module_under_test.rs"   # force a rebuild of just this crate
        start=$(python3 -c 'import time; print(time.time())')
        build || { echo "build failed mid-run" >&2; exit 1; }
        times+=("$(python3 -c "import time; print(f'{time.time()-$start:.2f}')")")
    done
    median=$(printf '%s\n' "${times[@]}" | sort -n | awk '{a[NR]=$1} END {print a[int((NR+1)/2)]}')

    printf "%-22s %8s %8s %10s\n" "$(basename "$input")" "$widest" "$lines" "$median"
done
