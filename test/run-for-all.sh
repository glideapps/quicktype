#!/usr/bin/env bash

LANGUAGE="swift"
OPTIONS="--just-types"

set -o errexit
set -o nounset
set -o pipefail

__dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SCHEMA_INPUT_DIR="$__dir/../test/inputs/schema"
JSON_INPUT_DIR="$__dir/../test/inputs/json"

OUTPUT_DIR="$1"

cd "$SCHEMA_INPUT_DIR"
for fn in `find . -name '*.schema'` ; do
    echo $fn
    fdir=`dirname "$fn"`
    fbase=`basename "$fn" .schema`
    odir="$OUTPUT_DIR/schema/$fdir"
    mkdir -p "$odir"
    node "$__dir/../dist/cli.js" --lang "$LANGUAGE" $OPTIONS --src-lang schema --quiet -o "$odir/$fbase.$LANGUAGE" "$fn"
done

cd "$JSON_INPUT_DIR"
for fn in `find . -name '*.json'` ; do
    echo $fn
    fdir=`dirname "$fn"`
    fbase=`basename "$fn" .json`
    odir="$OUTPUT_DIR/json/$fdir"
    mkdir -p "$odir"
    node "$__dir/../dist/cli.js" --lang "$LANGUAGE" $OPTIONS --quiet -o "$odir/$fbase.$LANGUAGE" "$fn"
done
