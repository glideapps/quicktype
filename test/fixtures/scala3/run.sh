#!/usr/bin/env bash

wget https://github.com/VirtusLab/scala-cli/releases/download/nightly/scala-cli-x86_64-pc-linux-static.gz
gunzip scala-cli-x86_64-pc-linux-static.gz
chmod +x scala-cli-x86_64-pc-linux-static
./scala-cli-x86_64-pc-linux-static  -v -v -v circe.scala TopLevel.scala 
