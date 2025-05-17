#!/usr/bin/env bash

if [[ $PUBLISH == true ]]; then
  echo 'HAS PUBLISH, exit'
  exit 0
fi

if [[ $CI ]]; then
	if [[ "$OSTYPE" == "darwin"* ]]; then
		grep -rl '$fetch' src | xargs sed -i '' -e 's/$fetch/$fetch.ci/g'
	else
		grep -rl '$fetch' src | xargs sed -i -e 's/$fetch/$fetch.ci/g'
	fi
fi
