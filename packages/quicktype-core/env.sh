#!/usr/bin/env bash

if [[ $CI ]]
then
	grep -rl '$fetch' src | xargs sed -i '' -e 's/$fetch/$fetch.ci/g'
fi

exit 0
