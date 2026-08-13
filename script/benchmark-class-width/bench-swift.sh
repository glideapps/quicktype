#!/usr/bin/env bash
# Tier 1 (no install needed on macOS): time swiftc against each candidate.
#
# Swift runs keyword-unions.schema in CI today, and its type checker is
# superlinear in the size of a single declaration -- the same property that
# makes rustc slow on wide serde derives.
#
# Usage:  bench-swift.sh --src-lang schema $BENCH/inputs/ku-{1,2,5,10}.schema
set -euo pipefail

REPS="${REPS:-3}"
MODE="${MODE:--typecheck}"   # -typecheck (fast) or -c (full codegen)
SRC_LANG=json
if [ "${1:-}" = "--src-lang" ]; then SRC_LANG="$2"; shift 2; fi

command -v swiftc >/dev/null || { echo "swiftc not found"; exit 1; }
[ -f dist/index.js ] || { echo "dist/index.js missing -- run npm run build"; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

printf "%-22s %8s %8s %10s\n" candidate widest lines "median_s"
printf -- "------------------------------------------------------\n"

for input in "$@"; do
    swift="$work/$(basename "${input%.*}").swift"
    node dist/index.js --lang swift --src-lang "$SRC_LANG" "$input" > "$swift" 2>/dev/null

    widest=$(awk '
        /^(public )?(final )?(struct|class|enum) / { inb=1; n=0; next }
        inb && /^ +(public )?(let|var) / { n++ }
        inb && /^}/ { inb=0; if (n>max) max=n }
        END { print max+0 }' "$swift")
    lines=$(wc -l < "$swift" | tr -d ' ')

    # A failed compile is fast, and would look like a great result.
    if ! swiftc $MODE -o "$work/out" "$swift" 2>"$work/err"; then
        echo "COMPILE FAILED for $(basename "$input") -- timings would be meaningless" >&2
        head -20 "$work/err" >&2
        exit 1
    fi

    times=()
    for _ in $(seq "$REPS"); do
        start=$(python3 -c 'import time; print(time.time())')
        swiftc $MODE -o "$work/out" "$swift" >/dev/null 2>&1 \
            || { echo "compile failed mid-run" >&2; exit 1; }
        times+=("$(python3 -c "import time; print(f'{time.time()-$start:.2f}')")")
    done
    median=$(printf '%s\n' "${times[@]}" | sort -n | awk '{a[NR]=$1} END {print a[int((NR+1)/2)]}')

    printf "%-22s %8s %8s %10s\n" "$(basename "$input")" "$widest" "$lines" "$median"
done
