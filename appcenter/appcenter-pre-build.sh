#!/usr/bin/env bash -e

cd $APPCENTER_SOURCE_DIRECTORY
source appcenter/slack.sh

#############
### Build ###
#############

if npm run build; then
    slack_notify_build_passed
else
    slack_notify_build_failed
    exit 1
fi

############
### Test ###
############

brew install go boost

time CI=true FIXTURE=swift script/test

###############
### Archive ###
###############

cp -r dist $APPCENTER_OUTPUT_DIRECTORY/