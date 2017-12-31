#!/usr/bin/env bash -e

cd $APPCENTER_SOURCE_DIRECTORY
source appcenter/slack.sh

#####################
### Deploy to npm ###
#####################

# TODO ^

if [ "$APPCENTER_BRANCH" == "master" ]; then
    # For now we assume we're just about to deploy to npm from Travis
    # but soon we will do all deployment here, once our full test suite
    # runs in App Center and App Center supports PRs.
    slack_notify_deployed
fi

#########################
### Deploy to VS Code ###
#########################

# TODO ^

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