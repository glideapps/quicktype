#!/bin/sh -eux

npm install --ignore-scripts
bower install --allow-root

pulp build --build-path "./output/raw" \
  -- --source-maps --censor-warnings --stash

## Purs Bundling ##
MODULE_ENTRIES="Main Samples" # Space-separated

MODULE_OPTS=""
for MOD in $MODULE_ENTRIES; do
  MODULE_OPTS="${MODULE_OPTS} -m ${MOD}"
done

purs bundle 'output/raw/**/index.js' 'output/raw/**/foreign.js' \
  -o output/purs/index.js \
  --source-maps \
  $MODULE_OPTS
echo ';module.exports = PS;' >> output/purs/index.js

for MOD in $MODULE_ENTRIES; do
  echo "'use strict';module.exports = require('./index')['${MOD}'];" > "output/purs/${MOD}.js"
done
## /Purs Bundling ##

tsc --project cli/tsconfig.json

BIN=output/quicktype.js
echo "#!/usr/bin/env node" > $BIN.bak
cat $BIN >> $BIN.bak
mv $BIN.bak $BIN