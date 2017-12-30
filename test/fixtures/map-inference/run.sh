#!/bin/bash

DIR="$( cd "$(dirname "${BASH_SOURCE[0]}" )" && pwd)"

node dist/cli.js  \
    -o $DIR/map.ts \
    --top-level Top \
    --runtime-typecheck \
    test/inputs/json/priority/map.json

ts-node --compilerOptions '{"target":"es6"}' \
    $DIR/main.ts