#!/usr/bin/env bash

kotlin -cp kotlinx-serialization-core-jvm-1.7.3.jar:kotlinx-serialization-json-jvm-1.7.3.jar:main.jar quicktype.MainKt "$1"
