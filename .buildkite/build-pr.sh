#!/bin/bash
set -euo pipefail

if [ "x$BUILDKITE_PULL_REQUEST_BASE_BRANCH" != "x" ] ; then
    git --no-pager config --global user.email "buildkitepr@quicktype.io" || true
    git --no-pager config --global user.name "Buildkite PR builder" || true

    git --no-pager branch -D pr || true
    git --no-pager fetch origin "pull/$BUILDKITE_PULL_REQUEST/head:pr"
    git --no-pager status
    git --no-pager checkout pr
    git --no-pager merge --no-edit master
fi

git --no-pager log 'HEAD~5..HEAD'

docker system prune --force

docker pull schani/quicktype
docker build --cache-from schani/quicktype -t quicktype .
docker run -t --workdir="/app" -e FIXTURE quicktype npm test
