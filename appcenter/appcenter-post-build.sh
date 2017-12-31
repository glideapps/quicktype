#!/usr/bin/env bash -e

cd $APPCENTER_SOURCE_DIRECTORY

##############################
### Deploy Xcode extension ###
##############################

if [ "$APPCENTER_BRANCH" == "master" ]; then
    appcenter \
        build queue \
        --app quicktype/quicktype-xcode \
        --branch master \
        --token $APPCENTER_TOKEN
fi