#!/bin/sh

"php" -f main.php "$@" | \
node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8').toString()), null, 2))"
exit $?
