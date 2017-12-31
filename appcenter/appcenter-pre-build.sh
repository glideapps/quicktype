#!/usr/bin/env bash -e

cd $APPCENTER_SOURCE_DIRECTORY
source appcenter/slack.sh

#############
### Build ###
#############

npm run build

############
### Test ###
############

brew install go boost

if time CI=true FIXTURE=swift script/test; then
    slack_notify_build_passed
else
    slack_notify_build_failed
    exit 1
fi

###############
### Archive ###
###############

cp -r dist $APPCENTER_OUTPUT_DIRECTORY/