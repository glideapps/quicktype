#!/bin/sh

if [ "x$QUICKTYPE_PYTHON_VERSION" = "x2.7" ] ; then
    PYTHON="python2.7"
else
    PYTHON="python3.6"
fi

"$PYTHON" "$@"
exit $?
