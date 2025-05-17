#!/usr/bin/env bash

if [[ $CI ]]
then
	echo 'FROG 1'
	# grep -rl '$fetch' src | xargs sed -i '' -e 's/$fetch/$fetch.ci/g'
else
	echo 'FROG 2'
fi

exit 0
