#!/bin/bash

# If not on CI, do a clean build
if [ -z "$CI" ]; then
    rm -rf output
    npm run build
fi

# Copy npm package files into output/
cp LICENSE* package*.json cli/README.md output/
cd output

# This is pretty silly, but we do it to make Travis deploy work
mkdir script
echo "#\!/bin/bash" > script/build.sh
chmod +x script/build.sh

# If not on CI, publish directly
if [ -z "$CI" ]; then
   npm publish
fi