#!/bin/bash

set -eu

docker run -t --workdir="/app" -e FIXTURE quicktype npm test
