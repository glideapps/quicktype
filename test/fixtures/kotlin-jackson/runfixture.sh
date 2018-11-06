#!/bin/bash

../../../script/quicktype --lang kotlin --framework jackson -t TopLevel -o TopLevel.kt "$1"
./build.sh

`./run.sh "$1"` | jq -S -M . > out.json
cat "$1" | jq -S -M . > in.json

diff in.json out.json

rm in.json out.json main.jar # TopLevel.kt
