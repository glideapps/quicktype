#!/usr/bin/env bash -e

cd $APPCENTER_SOURCE_DIRECTORY
source appcenter/slack.sh

if [ "$AGENT_JOBSTATUS" != "Succeeded" ]; then
    slack_notify_build_failed
    exit 0
fi

if [ "$APPCENTER_BRANCH" == "master" ]; then

    #####################
    ### Deploy to npm ###
    #####################

    echo '//registry.npmjs.org/:_authToken=${NPM_TOKEN}' > .npmrc
    npm run pub
    
    slack_notify_deployed

    #########################
    ### Deploy to VS Code ###
    #########################

    appcenter \
        build queue \
        --app quicktype/quicktype-vscode \
        --branch master \
        --token $APPCENTER_TOKEN

    ###############################
    ### Deploy app.quicktype.io ###
    ###############################

    appcenter \
        build queue \
        --app quicktype/app.quicktype.io \
        --branch master \
        --token $APPCENTER_TOKEN

    ##############################
    ### Deploy Xcode extension ###
    ##############################

    appcenter \
        build queue \
        --app quicktype/quicktype-xcode \
        --branch master \
        --token $APPCENTER_TOKEN

    ###############################
    ### Submit a PR to Homebrew ###
    ###############################

    # We only submit PRs when patch version ends in 0
    if [[ `npm show quicktype version` == *0 ]]; then
        script/homebrew-update.sh
    fi
fi
