#!/usr/bin/env bash

echo $CI
echo $NODE_AUTH_TOKEN


if [[ $NODE_AUTH_TOKEN ]]
then
	echo 'HAS NODE_AUTH_TOKEN, exit'
	exit 0
fi

if [[ $CI ]]
then
	echo 'grep'
	grep -rl '$fetch' src | xargs sed -i '' -e 's/$fetch/$fetch.ci/g'
fi

echo 'default exit'
exit 0
