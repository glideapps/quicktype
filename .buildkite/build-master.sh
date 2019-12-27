#!/bin/bash
set -euo pipefail

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$DIR/common.sh"

make_outputs_dir

docker pull dvdsgl/quicktype
docker build --cache-from dvdsgl/quicktype -t quicktype .
docker run -t --workdir="/app" -v "$QUICKTYPE_OUTPUTS:/quicktype-outputs" -e "OUTPUT_DIR=/quicktype-outputs" -e "ONLY_OUTPUT=1" quicktype npm run test

commit_outputs
