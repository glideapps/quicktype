#!/usr/bin/env bash

if [ -n $NODE_AUTH_TOKEN ]
then
	echo 'HAS NODE_AUTH_TOKEN, exit'
	exit 0
fi

if [[ $CI ]]
then
	grep -rl '$fetch' src | xargs sed -i '' -e 's/$fetch/$fetch.ci/g'
fi

exit 0
