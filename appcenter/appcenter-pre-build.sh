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

# TODO re-enable these when we run go and C++ fixtures
# brew install go boost

# TODO run full test suite when we deprecate Travis
export FIXTURE=swift,objective-c
if script/test; then
    slack_notify_build_passed
else
    slack_notify_build_failed
    exit 1
fi

###############
### Archive ###
###############

cp -r dist $APPCENTER_OUTPUT_DIRECTORY/