#!/usr/bin/env bash

VERSION=$(npm version patch --force)
npm version $VERSION --workspaces --force

npm publish
npm publish --workspaces --if-present