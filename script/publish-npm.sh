#!/usr/bin/env bash

# Publishes the npm packages (quicktype-core, quicktype-typescript-input,
# quicktype-graphql-input, and the root quicktype CLI). The VS Code
# extension is published separately by script/publish-vscode.sh — the two
# are independent (the extension bundles its quicktype dependencies from
# local source at build time), so they run as separate CI workflows.

set -e

: "${RELEASE_VERSION:?RELEASE_VERSION must be set from the GitHub release tag}"
./script/release-version.ts stamp "$RELEASE_VERSION"
NPM_TAG=$(./script/release-version.ts npm-tag "$RELEASE_VERSION")

publish_package() {
    local directory=$1
    local package=$2
    local action

    action=$(./script/release-version.ts npm-action "$package" "$RELEASE_VERSION")
    if [[ "$action" == "skip" ]]; then
        echo "* $package@$RELEASE_VERSION is already published; skipping"
        return
    fi

    pushd "$directory"
    npm publish --tag "$NPM_TAG"
    popd
}

publish_package packages/quicktype-core quicktype-core
publish_package packages/quicktype-typescript-input quicktype-typescript-input
publish_package packages/quicktype-graphql-input quicktype-graphql-input
publish_package . quicktype
