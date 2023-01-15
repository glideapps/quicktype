#!/usr/bin/env bash

./script/patch-npm-version.ts

npm publish --dry-run
npm publish --workspaces --if-present --dry-run