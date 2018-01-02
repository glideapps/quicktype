#!/usr/bin/env bash

set -o errexit
set -o nounset
set -o pipefail

__dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DIR1="$1"
DIR2="$2"
DIFFDIR="$3"

for fn in `cd "$DIR1" ; find . -type f` ; do
    fdir=`dirname "$fn"`
    mkdir -p "$DIFFDIR/$fdir"
    f1="$DIR1/$fn"
    f2="$DIR2/$fn"
    if [ -f "$f2" ] ; then
        of="$DIFFDIR/$fn.diff"
        set +e
        diff -u "$f1" "$f2" >"$of"
        set -e
        stat=`diffstat -s "$of"`
        lines=`cat "$of" | wc -l`
        echo "$lines $stat $fn"
    else
        echo "missing $fn"
    fi
done
