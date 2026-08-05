#!/usr/bin/env bash

SCALA_CLI_EXTRA_TIMEOUT="${SCALA_CLI_EXTRA_TIMEOUT:-2min}" scala-cli run upickle.scala TopLevel.scala
