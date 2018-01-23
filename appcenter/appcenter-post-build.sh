#!/usr/bin/env bash -e

cd $APPCENTER_SOURCE_DIRECTORY
source appcenter/slack.sh

if [ "$AGENT_JOBSTATUS" != "Succeeded" ]; then
    slack_notify_build_failed
    exit 0
fi

#####################
### Deploy to npm ###
#####################

if [ "$APPCENTER_BRANCH" == "master" ]; then
    # For now we assume we're just about to deploy to npm from Travis
    # but soon we will do all deployment here, once our full test suite
    # runs in App Center and App Center supports PRs.
    echo '//registry.npmjs.org/:_authToken=${NPM_TOKEN}' > .npmrc
    npm run pub
    
    slack_notify_deployed
fi

#########################
### Deploy to VS Code ###
#########################

if [ "$APPCENTER_BRANCH" == "master" ]; then
    appcenter \
        build queue \
        --app quicktype/quicktype-vscode \
        --branch master \
        --token $APPCENTER_TOKEN
fi

###############################
### Deploy app.quicktype.io ###
###############################

if [ "$APPCENTER_BRANCH" == "master" ]; then
    appcenter \
        build queue \
        --app quicktype/app.quicktype.io \
        --branch master \
        --token $APPCENTER_TOKEN
fi

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

###############################
### Submit a PR to Homebrew ###
###############################

if [ "$APPCENTER_BRANCH" == "master" ]; then
    # We only submit PRs when patch version ends in 0
    if [[ `npm show quicktype version` == *0 ]]; then
        script/homebrew-update.sh
    fi
fi
