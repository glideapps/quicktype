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

    echo '//registry.npmjs.org/:_authToken=${NPM_TOKEN}' > ~/.npmrc
    npm run pub
    
    slack_notify_deployed
    
    ###############################
    ### Deploy app.quicktype.io ###
    ###############################

    curl -H "Authorization: Bearer $BUILDKITE_TOKEN" \
        https://api.buildkite.com/v2/organizations/typeguard/pipelines/app-dot-quicktype-dot-io/builds \
        -X POST \
        -F "commit=HEAD" \
        -F "branch=master" \
        -F "message=Deploy :rocket:"

    #########################
    ### Deploy to VS Code ###
    #########################

    appcenter \
        build queue \
        --app quicktype/quicktype-vscode \
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
        # Set git credentials for the Homebrew PR
        git config --global user.name "David Siegel"
        git config --global user.email "djsiegel@gmail.com"
        
        script/homebrew-update.sh
        slack_notify_homebrew_bump
    fi
fi

if [ "$APPCENTER_BRANCH" == "next" ]; then

    ####################################
    ### Deploy to npm with @next tag ###
    ####################################

    echo '//registry.npmjs.org/:_authToken=${NPM_TOKEN}' > .npmrc
    npm run pub
    
    slack_notify_deployed
    
    ################################
    ### Deploy next.quicktype.io ###
    ################################

    appcenter \
        build queue \
        --app quicktype/app.quicktype.io \
        --branch next \
        --token $APPCENTER_TOKEN
fi
