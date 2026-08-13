#!/usr/bin/env bash
# Tier 1, C++ -- the strongest non-Rust case for the hypothesis.
#
# nlohmann/json instantiates from_json/to_json templates per field, so a wide
# class means a lot of template instantiation concentrated in one translation
# unit.  Unlike Rust there is no dependency build to exclude: json.hpp is
# header-only, so each compile is the whole cost and no shared target dir trick
# is needed.
#
# Usage:  bench-cpp.sh --src-lang json $BENCH/inputs/blns-{1,2,4,8}.json
set -euo pipefail

REPS="${REPS:-3}"
SRC_LANG=json
if [ "${1:-}" = "--src-lang" ]; then SRC_LANG="$2"; shift 2; fi

command -v g++ >/dev/null || { echo "g++ not found"; exit 1; }
[ -f dist/index.js ] || { echo "dist/index.js missing -- run npm run build"; exit 1; }

BENCH="${BENCH:-${CLAUDE_JOB_DIR:-/tmp}/bench}"
work="$BENCH/cpp"
mkdir -p "$work"
cp test/fixtures/cplusplus/main.cpp test/fixtures/cplusplus/Generators.hpp "$work/"

# Same pinned revision the cplusplus fixture's setupCommand uses.
if [ ! -f "$work/json.hpp" ]; then
    echo "fetching json.hpp ..." >&2
    curl -fsS -o "$work/json.hpp" \
        https://raw.githubusercontent.com/nlohmann/json/87df1d6708915ffbfa26a051ad7562ecc22e5579/src/json.hpp
fi

printf "%-22s %8s %8s %10s\n" candidate widest lines "median_s"
printf -- "------------------------------------------------------\n"

for input in "$@"; do
    node dist/index.js --lang cplusplus --src-lang "$SRC_LANG" --top-level TopLevel \
        "$input" > "$work/quicktype.hpp" 2>/dev/null

    widest=$(awk '
        /^ *(struct|class) [A-Za-z_]/ { inb=1; n=0; next }
        inb && /^ +[A-Za-z_].*;$/ { n++ }
        inb && /^ *};/ { inb=0; if (n>max) max=n }
        END { print max+0 }' "$work/quicktype.hpp")
    lines=$(wc -l < "$work/quicktype.hpp" | tr -d ' ')

    # A failed compile is fast and would look like a great result.
    if ! (cd "$work" && g++ -O0 -o quicktype -std=c++17 main.cpp 2>"$work/err"); then
        echo "COMPILE FAILED for $(basename "$input") -- timings would be meaningless" >&2
        head -20 "$work/err" >&2
        exit 1
    fi

    times=()
    for _ in $(seq "$REPS"); do
        start=$(python3 -c 'import time; print(time.time())')
        (cd "$work" && g++ -O0 -o quicktype -std=c++17 main.cpp 2>/dev/null) \
            || { echo "compile failed mid-run" >&2; exit 1; }
        times+=("$(python3 -c "import time; print(f'{time.time()-$start:.2f}')")")
    done
    median=$(printf '%s\n' "${times[@]}" | sort -n | awk '{a[NR]=$1} END {print a[int((NR+1)/2)]}')

    printf "%-22s %8s %8s %10s\n" "$(basename "$input")" "$widest" "$lines" "$median"
done
