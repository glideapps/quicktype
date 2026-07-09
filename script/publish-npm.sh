#!/usr/bin/env bash

# Publishes the npm packages (quicktype-core, quicktype-typescript-input,
# quicktype-graphql-input, and the root quicktype CLI). The VS Code
# extension is published separately by script/publish-vscode.sh — the two
# are independent (the extension bundles its quicktype dependencies from
# local source at build time), so they run as separate CI workflows.

set -e

./script/patch-npm-version.ts

VERSION=$(jq -r '.version' package.json )
npm version $VERSION --workspaces --force

# Publish core
pushd packages/quicktype-core
npm publish
popd

# Publish typescript input
pushd packages/quicktype-typescript-input
jq --arg version $VERSION \
    '.dependencies."quicktype-core" = $version' \
    package.json > package.1.json
mv package.1.json package.json
npm publish
popd

# Publish graphql input
pushd packages/quicktype-graphql-input
jq --arg version $VERSION \
    '.dependencies."quicktype-core" = $version' \
    package.json > package.1.json
mv package.1.json package.json
npm publish
popd

# Publish quicktype
jq --arg version $VERSION \
    '.dependencies."quicktype-core" = $version | .dependencies."quicktype-graphql-input" = $version | .dependencies."quicktype-typescript-input" = $version' \
    package.json > package.1.json
mv package.1.json package.json
npm publish
