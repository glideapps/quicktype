#!/usr/bin/env bash

kotlinc main.kt TopLevel.kt -include-runtime -cp jackson-annotations-2.9.0.jar:jackson-core-2.9.7.jar:jackson-databind-2.9.7.jar:jackson-module-kotlin-2.9.7.jar -d main.jar
