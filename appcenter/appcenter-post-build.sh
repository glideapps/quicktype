#!/usr/bin/env bash -e

cd $APPCENTER_SOURCE_DIRECTORY

###############################
### Deploy app.quicktype.io ###
###############################

if [ "$APPCENTER_BRANCH" == "appcenter" ]; then
    appcenter \
        build queue \
        --app quicktype/app.quicktype.io \
        --branch master \
        --token $APPCENTER_TOKEN
fi

##############################
### Deploy Xcode extension ###
##############################

if [ "$APPCENTER_BRANCH" == "appcenter" ]; then
    appcenter \
        build queue \
        --app quicktype/quicktype-xcode \
        --branch master \
        --token $APPCENTER_TOKEN
fi