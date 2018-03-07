#!/bin/bash
set -euo pipefail

if [ "x$BUILDKITE_PULL_REQUEST_BASE_BRANCH" != "x" ] ; then
    git --no-pager config --global user.email "buildkitepr@quicktype.io" || true
    git --no-pager config --global user.name "Buildkite PR builder" || true

    git --no-pager branch -D pr || true
    git --no-pager fetch origin "pull/$BUILDKITE_PULL_REQUEST/head:pr"
    git --no-pager status
    git --no-pager checkout pr
    BUILDKITE_COMMIT="`git rev-parse HEAD`"
    git --no-pager merge --no-edit master
fi

git --no-pager log 'HEAD~5..HEAD'

QUICKTYPE_OUTPUTS="`mktemp -d`"

docker system prune --force

docker pull schani/quicktype
docker build --cache-from schani/quicktype -t quicktype .
docker run -t --workdir="/app" -e FIXTURE -v "$QUICKTYPE_OUTPUTS:/quicktype-outputs" -e "OUTPUT_DIR=/quicktype-outputs" quicktype npm test

pushd ..
aws --output text ssm get-parameters --names buildkite-id-rsa --with-decryption --query 'Parameters[0].Value' >id_rsa
chmod 600 id_rsa

GIT_SSH_COMMAND='ssh -i id_rsa' git clone git@github.com:quicktype/quicktype-outputs.git
cd ./quicktype-outputs
cp -r "$QUICKTYPE_OUTPUTS"/* ./outputs/$BUILDKITE_COMMIT/
git --no-pager add -A
git --no-pager commit --no-edit -m "Outputs for $BUILDKITE_COMMIT"

GIT_SSH_COMMAND='ssh -i ../id_rsa' git push origin master
popd
