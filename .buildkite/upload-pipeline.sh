#!/usr/bin/env bash

node_modules/.bin/ts-node \
    --project test/tsconfig.json \
    .buildkite/generate-pipeline.ts \
    | buildkite-agent pipeline upload