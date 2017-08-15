#!/bin/bash

npm install --ignore-scripts
bower install
script/correct-cpus.sh pulp build -- --source-maps --stash --censor-warnings
npm run bundle-cli