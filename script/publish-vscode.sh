#!/usr/bin/env bash

# Publishes the VS Code extension to the Marketplace. This is independent
# of the npm publish (script/publish-npm.sh): the extension bundles its
# quicktype-core / quicktype-typescript-input dependencies from local
# source via esbuild at build time, so it does not depend on the npm
# packages having been published. It runs as its own CI workflow so its
# success/failure is visible separately from the npm publish.

set -e

: "${RELEASE_VERSION:?RELEASE_VERSION must be set from the GitHub release tag}"
./script/release-version.ts stamp "$RELEASE_VERSION"

ACTION=$(./script/release-version.ts marketplace-action "$RELEASE_VERSION")
if [[ "$ACTION" == "skip" ]]; then
    echo "* quicktype.quicktype@$RELEASE_VERSION is already published; skipping"
    exit 0
fi

# Publish vscode extension
pushd packages/quicktype-vscode
npm run pub
popd
