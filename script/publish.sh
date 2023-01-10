#!/usr/bin/env bash

./script/patch-npm-version.ts
npm publish

( cd build/quicktype-core ; node build.js publish )
( cd build/quicktype-typescript-input ; node build.js publish )
( cd build/quicktype-graphql-input ; node build.js publish )
