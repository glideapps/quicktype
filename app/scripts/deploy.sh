#!/bin/bash

npm run build

# Don't deploy our sourcemaps
find build -name \*.js.map | xargs rm