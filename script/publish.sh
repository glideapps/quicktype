#!/bin/bash

OUTDIR=dist

./script/patch-npm-version.ts

# If not on CI, do a clean build
if [ -z "$CI" ]; then
    rm -rf $OUTDIR
    npm run build
fi

# If not on CI, publish directly
if [ -z "$CI" ]; then
   npm publish \
    --ignore-scripts # Don't rebuild
fi