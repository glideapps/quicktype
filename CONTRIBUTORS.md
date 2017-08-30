[![Build Status](https://travis-ci.com/dvdsgl/quicktype.svg?token=PSTj9tVyM1RDRiZ17Sgd&branch=master)](https://travis-ci.com/dvdsgl/quicktype)

## Setup

```shell
$ npm install
```

## Build

```shell
$ npm run build
```

## Test

```shell
$ npm test
```

### Test only a specific fixture

```shell
$ FIXTURE=golang npm test
```

Fixtures are defined in `test/test.ts`.

### Requirements

#### C#

[`dotnetcore`](https://www.microsoft.com/net/core#macos)

#### Java

[Maven](https://maven.apache.org/) (for example via [Homebrew](https://brew.sh))

On MacOS that seems to be sufficient to run the tests with the system Java.

## Edit

```shell
$ code . # open in VSCode
```

Install the `purescript-ide` extension in VSCode, then use the command pallete to start the `psc-ide` server for code completion, etc.

## Play

```shell
$ npm start
```

The react app will live-reload when you edit any source.

## Deploy

* Commit to master to deploy `quicktype.io`.
* The `quicktype` CLI will also deploy to NPM if it has a newer version number.