# Build the merge commit of the PR
git fetch origin +refs/pull/$BUILDKITE_PULL_REQUEST/merge:
git checkout -qf FETCH_HEAD

docker system prune --force
docker pull schani/quicktype
docker build --cache-from schani/quicktype -t quicktype .
docker run -t --workdir="/app" -e FIXTURE quicktype npm test
