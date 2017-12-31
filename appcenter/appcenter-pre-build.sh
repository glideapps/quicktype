#!/usr/bin/env bash -e

cd $APPCENTER_SOURCE_DIRECTORY

#############
### Build ###
#############

npm run build

############
### Test ###
############

brew install go boost

time CI=true FIXTURE=swift script/test

###############
### Archive ###
###############

cp -r dist $APPCENTER_OUTPUT_DIRECTORY/