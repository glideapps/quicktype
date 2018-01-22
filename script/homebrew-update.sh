#!/bin/bash

# Create a GitHub token with public_repo scope: https://github.com/settings/tokens/new
# Then set it as:
# HOMEBREW_GITHUB_TOKEN=...

URL=$(npm info quicktype --json | jq -r .dist.tarball)
SHA=$(curl $URL | shasum -a 256)
brew bump-formula-pr --strict quicktype --url="$URL" --sha256="$SHA"
