#!/usr/bin/env bash

# The kotlinx-serialization compiler plugin ships with the Kotlin compiler
# distribution, in lib/ next to bin/kotlinc.
KOTLINC_PATH="$(readlink -f "$(command -v kotlinc)")"
KOTLIN_LIB="$(cd "$(dirname "$KOTLINC_PATH")/../lib" && pwd)"

kotlinc main.kt TopLevel.kt -include-runtime -Xplugin="$KOTLIN_LIB/kotlinx-serialization-compiler-plugin.jar" -cp kotlinx-serialization-core-jvm-1.7.3.jar:kotlinx-serialization-json-jvm-1.7.3.jar -d main.jar
