#!/usr/bin/env bash

LANGUAGE="types"

set -o errexit
set -o nounset
set -o pipefail

__dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

INPUT_DIR="$__dir/../test/inputs/json"
OUTPUT_DIR="$1"

cd "$INPUT_DIR"
for fn in `find . -name '*.json'` ; do
    echo $fn
    fdir=`dirname "$fn"`
    fbase=`basename "$fn" .json`
    odir="$OUTPUT_DIR/$fdir"
    #echo $odir
    mkdir -p "$odir"
    node "$__dir/../dist/cli.js" --lang "$LANGUAGE" --quiet -o "$odir/$fbase.$LANGUAGE" "$fn"
done
