#!/bin/bash
set -euo pipefail

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$DIR/common.sh"

make_outputs_dir

docker system prune --force

#docker pull schani/quicktype
docker build -t quicktype .
docker run -t --workdir="/app" -e FIXTURE -v "$QUICKTYPE_OUTPUTS:/quicktype-outputs" -e "OUTPUT_DIR=/quicktype-outputs" quicktype npm test

commit_outputs
