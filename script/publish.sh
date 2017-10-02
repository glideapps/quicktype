#!/bin/bash

OUTDIR=dist

# If not on CI, do a clean build
if [ -z "$CI" ]; then
    rm -rf $OUTDIR
    npm run build
fi

# Copy npm package files into output/
mkdir -p output
cp -r LICENSE* package*.json cli/README.md $OUTDIR/

cd $OUTDIR
# If not on CI, publish directly
if [ -z "$CI" ]; then
   npm publish \
    --ignore-scripts # Don't rebuild
fi