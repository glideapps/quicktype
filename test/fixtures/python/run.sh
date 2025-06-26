#!/bin/sh

if [ "x$QUICKTYPE_PYTHON_VERSION" = "x2.7" ] ; then
    PYTHON="python2.7"
else
    PYTHON="python3.9"
fi

"$PYTHON" "$@"
exit $?
