#!/usr/bin/env bash

if [[ $CI && !$NODE_AUTH_TOKEN ]]
then
	grep -rl '$fetch' src | xargs sed -i '' -e 's/$fetch/$fetch.ci/g'
fi

exit 0
