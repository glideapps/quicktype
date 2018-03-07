#!/bin/bash
set -euo pipefail

if [[ "$BUILDKITE_PULL_REQUEST" != "false" ]]; then
    BUILDKITE_COMMIT="`git rev-parse HEAD^`"
fi

QUICKTYPE_OUTPUTS="`mktemp -d`"

docker system prune --force

docker pull schani/quicktype
docker build --cache-from schani/quicktype -t quicktype .
docker run -t --workdir="/app" -e FIXTURE -v "$QUICKTYPE_OUTPUTS:/quicktype-outputs" -e "OUTPUT_DIR=/quicktype-outputs" quicktype npm test

pushd ..
aws --output text ssm get-parameters --names buildkite-id-rsa --with-decryption --query 'Parameters[0].Value' >id_rsa
chmod 600 id_rsa

if [ -d quicktype-outputs ] ; then
    rm -rf quicktype-outputs
fi
GIT_SSH_COMMAND='ssh -i id_rsa' git clone git@github.com:quicktype/quicktype-outputs.git
cd ./quicktype-outputs
if [ ! -d outputs ] ; then
    mkdir outputs
fi
COMMIT_DIR="`pwd`/outputs/$BUILDKITE_COMMIT"
if [ ! -d "$COMMIT_DIR" ] ; then
    mkdir "$COMMIT_DIR"
fi
cp -r "$QUICKTYPE_OUTPUTS"/* "$COMMIT_DIR/"
git --no-pager add -A
git --no-pager commit --no-edit -m "Outputs for $BUILDKITE_COMMIT"

GIT_SSH_COMMAND='ssh -i ../id_rsa' git push origin master
popd
