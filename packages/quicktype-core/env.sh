#!/usr/bin/env bash

echo $CI
echo $NODE_AUTH_TOKEN
echo ($CI & !$NODE_AUTH_TOKEN)


if [[ ! -v NODE_AUTH_TOKEN ]]
then
	exit 0
fi

if [[ $CI ]]
then
	grep -rl '$fetch' src | xargs sed -i '' -e 's/$fetch/$fetch.ci/g'
fi

exit 0
