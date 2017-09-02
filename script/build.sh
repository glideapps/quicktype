#!/bin/sh

npm install --ignore-scripts
bower install --allow-root
pulp build -- --source-maps --stash --censor-warnings

tsc --project cli/tsconfig.json

BIN=output/quicktype.js
echo "#!/usr/bin/env node" > $BIN.bak
cat $BIN >> $BIN.bak
mv $BIN.bak $BIN