#!/usr/bin/env bash

OUTDIR=dist

./script/patch-npm-version.ts

rm -rf $OUTDIR
npm run build


npm publish --ignore-scripts # Don't rebuild

( cd build/quicktype-core ; node build.js publish )
( cd build/quicktype-typescript-input ; node build.js publish )
( cd build/quicktype-graphql-input ; node build.js publish )
