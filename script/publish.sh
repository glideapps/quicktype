#!/bin/bash

OUTDIR=dist

# If not on CI, do a clean build
if [ -z "$CI" ]; then
    rm -rf $OUTDIR
    npm run build
fi

# Copy npm package files into output/
mkdir -p output
cp -r LICENSE* package*.json $OUTDIR/

cd $OUTDIR

# Travis looks for this script when it does npm publish
# We have to do this since we're building and publishing in
# different folders
mkdir script
printf "#!/bin/bash\ntrue\n" > script/build.ts
chmod +x script/build.ts

# If not on CI, publish directly
if [ -z "$CI" ]; then
   npm publish \
    --ignore-scripts # Don't rebuild
fi