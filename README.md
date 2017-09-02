[![Build Status](https://travis-ci.com/dvdsgl/quicktype.svg?token=PSTj9tVyM1RDRiZ17Sgd&branch=master)](https://travis-ci.com/dvdsgl/quicktype)

## Setup

```shell
$ npm install
```

## Build

```shell
$ npm run build
```

## Edit

```shell
$ code . # open in VSCode
```

Install the `purescript-ide` extension in VSCode, then use the command pallete to start the `psc-ide` server for code completion, etc.

### Live-reloading for quick feedback

If you're working on a renderer, you'll likely want quick feedback on renderer output as you edit.
Use `npm start` to watch PureScript files for changes, and recompile and rerun `quicktype` for
live feedback. For example, if you're developing a new renderer for `fortran`, you
could use the following command to rebuild and reinvoke `quicktype` as you implement your renderer:

```shell
$ npm start -- "--lang fortran test/inputs/json/samples/bitcoin-block.json"
```

The command in quotes is passed to `quicktype`, so you can render local `.json` files, URLs, or add other options.

## Test

```shell
$ npm test
```

### Requirements

* [`dotnetcore`](https://www.microsoft.com/net/core#macos)
* [Maven](https://maven.apache.org/) (for example via [Homebrew](https://brew.sh))

On macOS the system Java seems sufficient to run tests.

### Test only a specific fixture

```shell
$ FIXTURE=golang npm test
```

### Using Docker

```shell
$ docker build --cache-from dvdsgl/quicktype -t quicktype .
$ docker run -t quicktype test/test
$ # run specific fixtures
$ docker run -t quicktype sh -c "FIXTURE=golang,java test/test"
```
