#!/bin/bash -e

OUTDIR=dist

./script/patch-npm-version.ts

rm -rf $OUTDIR
npm run build

if [ "$APPCENTER_BRANCH" == "next" ]; then
    npm publish --ignore-scripts --tag next
else
    npm publish --ignore-scripts # Don't rebuild
fi
