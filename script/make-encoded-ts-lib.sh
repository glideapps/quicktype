#!/bin/bash

rm -f /tmp/lib.d.ts /tmp/lib.d.ts.gz
cp ../data/lib.d.ts /tmp/lib.d.ts
gzip -9 /tmp/lib.d.ts
echo -n 'export const encodedDefaultTypeScriptLibrary = "'
base64 /tmp/lib.d.ts.gz | tr -d '\n'
echo '";'
