docker system prune --force

docker pull schani/quicktype
docker build --cache-from schani/quicktype -t quicktype .
docker run -t --workdir="/app" -e FIXTURE quicktype npm test
