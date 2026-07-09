#!/usr/bin/env bash

# Publishes the VS Code extension to the Marketplace. This is independent
# of the npm publish (script/publish-npm.sh): the extension bundles its
# quicktype-core / quicktype-typescript-input dependencies from local
# source via esbuild at build time, so it does not depend on the npm
# packages having been published. It runs as its own CI workflow so its
# success/failure is visible separately from the npm publish.

set -e

# Derive the same release version the npm publish uses, so the extension
# stays version-aligned with the npm packages, then stamp it onto the
# extension package (only — no git tag, no other workspaces).
./script/patch-npm-version.ts
VERSION=$(jq -r '.version' package.json )
npm version $VERSION --force --no-git-tag-version -w packages/quicktype-vscode

# Publish vscode extension
pushd packages/quicktype-vscode
npm run pub
popd
