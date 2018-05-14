#!/usr/bin/env bash

kotlinc main.kt TopLevel.kt -include-runtime \
    -cp lib/moshi-1.6.0-RC1.jar:lib/moshi-kotlin-1.6.0-RC1.jar \
    -d main.jar