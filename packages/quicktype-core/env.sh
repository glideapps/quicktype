#!/usr/bin/env bash

echo $PUBLISH

if [[ $PUBLISH == true ]]
then
  echo 'HAS PUBLISH, exit'
  exit 0
fi

if [[ $CI ]]
then
	pwd
  grep -rl '$fetch' src | xargs sed -i '' -e 's/$fetch/$fetch.ci/g'
fi
