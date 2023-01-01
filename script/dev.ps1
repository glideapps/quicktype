# docker pull schani/quicktype
docker build --cache-from quicktype -t quicktype .

docker run -it `
    -p 3000:3000 `
    --volume=$($PWD.path):/quicktype `
    --workdir="/quicktype" `
    --entrypoint=/bin/bash `
    quicktype
