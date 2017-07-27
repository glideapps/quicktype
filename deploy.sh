#!/bin/bash

export DEPLOY_COUNT=$((DEPLOY_COUNT+1))

case $DEPLOY_COUNT in
  1)
    # Deploying firebase react app
    cd app && npm run deploy && cd ..
    ;;
  2)
    # Deploying npm
    cd cli # we have to cd here to make npm deploy the CLI correctly
    ;;
esac
