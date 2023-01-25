#!/usr/bin/env bash

mv /usr/local/bin/scala-cli scala-cli
ls
./scala-cli -v -v -v circe.scala TopLevel.scala
