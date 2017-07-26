#!/bin/bash

export DEPLOY_COUNT=$((DEPLOY_COUNT+1))

echo about to deploy $DEPLOY_COUNT
pwd
ls
ls app

case $DEPLOY_COUNT in
  1)
    # Deploying npm
    cd cli # we have to cd here to make npm deploy the CLI correctly
    ;;
  2)
    # Deploying gcs react app
    cd app && npm run deploy && cd ..
    ;;
  3)
    # Deploying firebase
    ;;
esac
