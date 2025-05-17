#!/usr/bin/env bash

echo $PUBLISH

if [[ $PUBLISH == true ]]
then
  echo 'HAS PUBLISH, exit'
  exit 0
else
	echo 'false'
fi

if [[ $CI ]]
then
  grep -rl '$fetch' src | xargs sed -i '' -e 's/$fetch/$fetch.ci/g'
fi
