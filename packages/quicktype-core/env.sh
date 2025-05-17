#!/usr/bin/env bash

echo $NODE_AUTH_TOKEN

if [ -v $NODE_AUTH_TOKEN ] && [[ $CI ]]
then
    grep -rl '$fetch' src | xargs sed -i '' -e 's/$fetch/$fetch.ci/g'
else
  echo 'HAS NODE_AUTH_TOKEN, skip'
fi
