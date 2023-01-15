#!/usr/bin/env bash

VERSION=$(npm version patch --force)
npm version $VERSION --workspaces --force

# This is not great, but we need to get the dependencies to workspaces
jq --arg version $VERSION \
    '.dependencies."quicktype-core" = $version | .dependencies."quicktype-graphql-input" = $version | .dependencies."quicktype-typescript-input" = $version' \
    package.json > package.1.json
mv package.1.json package.json

npm publish


jq --arg version $VERSION \
    '.dependencies."quicktype-core" = $version' \
    packages/quicktype-typescript-input/package.json > package.1.json
mv package.1.json packages/quicktype-typescript-input/package.json

npm publish --workspaces --if-present