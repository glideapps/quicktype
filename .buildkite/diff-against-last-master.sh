#!/bin/bash
set -euo pipefail

PR_COMMIT=`git rev-parse "$BUILDKITE_COMMIT"`

MASTER_DIR="`mktemp -d`"
PR_DIR="`mktemp -d`"
DIFF_DIR="`mktemp -d`"

MASTER_COMMIT="`git rev-parse master`"

echo "master is $MASTER_COMMIT"
echo "origin/master is `git rev-parse origin/master`"

until aws s3 ls "s3://quicktype-outputs/$MASTER_COMMIT/outputs.tar.gz" >/dev/null ; do
        echo "No output found for $MASTER_COMMIT"
        MASTER_COMMIT="`git rev-parse $MASTER_COMMIT^`"
done
echo "Output found for $MASTER_COMMIT"

pushd "$MASTER_DIR"
aws s3 cp "s3://quicktype-outputs/$MASTER_COMMIT/outputs.tar.gz" .
tar -zxf outputs.tar.gz
rm outputs.tar.gz
# We don't test Objective-C, but it's included in the master outputs
rm -rf commit objective-c
popd

pushd "$PR_DIR"
aws s3 cp --recursive --exclude "*" --include "outputs-*.tar.gz" "s3://quicktype-outputs/$PR_COMMIT/" .
for FILENAME in outputs-*.tar.gz ; do
        tar -zxf $FILENAME
        rm $FILENAME
        rm commit
done
popd

DIFF_FILENAME="$MASTER_COMMIT-$PR_COMMIT.diff"
if diff -Naur "$MASTER_DIR" "$PR_DIR" >"$DIFF_DIR/$DIFF_FILENAME" ; then
        echo "No changes found"
else
        S3_PATH="quicktype-outputs/diffs/$DIFF_FILENAME"
        aws s3 cp --acl public-read "$DIFF_DIR/$DIFF_FILENAME" "s3://$S3_PATH"
        echo "Changes found, uploaded to https://s3.amazonaws.com/$S3_PATH"
        exit 1
fi
