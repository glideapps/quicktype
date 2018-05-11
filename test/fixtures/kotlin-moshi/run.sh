#!/usr/bin/env bash

kotlin \
    -cp lib/moshi-1.6.0-RC1.jar:lib/moshi-kotlin-1.6.0-RC1.jar:main.jar:lib/okio-1.14.1.jar \
    quicktype.MainKt sample.json