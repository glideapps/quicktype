#!/bin/bash

npm run build

# Don't deploy our sourcemaps
find build -name \*.js.map | xargs rm

cd build
now
pbpaste | xargs -0 -I {} now alias {} quicktype.io
