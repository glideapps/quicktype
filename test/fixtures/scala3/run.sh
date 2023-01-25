#!/usr/bin/env bash

mv /usr/local/bin/scala-cli scala-cli
scala-cli -v -v -v circe.scala TopLevel.scala
