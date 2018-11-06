#!/usr/bin/env bash

kotlin -cp jackson-annotations-2.9.0.jar:jackson-core-2.9.7.jar:jackson-databind-2.9.7.jar:jackson-module-kotlin-2.9.7.jar:main.jar quicktype.MainKt "$1"
