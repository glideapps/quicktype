#!/bin/sh

npm install

mkdir -p bin/macos
mkdir -p bin/linux
mkdir -p bin/windows
pkg -t node8-macos-x64 -o bin/macos/quicktype dist/cli.js
pkg -t node8-linux-x64 -o bin/linux/quicktype dist/cli.js
pkg -t node8-win-x64 -o bin/windows/quicktype.exe dist/cli.js
