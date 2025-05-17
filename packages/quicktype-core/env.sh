#!/usr/bin/env bash

if [ $PUBLISH ]
then
  echo 'HAS PUBLISH, exit'
  exit 0
fi

if [[ $CI ]]
then
  grep -rl '$fetch' src | xargs sed -i '' -e 's/$fetch/$fetch.ci/g'
fi
