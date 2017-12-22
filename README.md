[![npm version](https://badge.fury.io/js/quicktype.svg)](https://badge.fury.io/js/quicktype)
[![Build Status](https://travis-ci.org/quicktype/quicktype.svg?branch=master)](https://travis-ci.org/quicktype/quicktype)
[![Join us in Slack](http://slack.quicktype.io/badge.svg)](http://slack.quicktype.io/)

## Setup, Build, Run

```shell
$ npm install
$ npm run build
$ script/quicktype # rebuild and run
```

## Edit

Install [Visual Studio Code](https://code.visualstudio.com/), open this
workspace, and install the recommended extensions:

```shell
$ code . # opens in VS Code
```

## Live-reloading for quick feedback

When working on an output language, you'll want to view generated
output as you edit. Use `npm start` to watch for changes and
recompile and rerun `quicktype` for live feedback. For example, if you're
developing a new renderer for `fortran`, you could use the following command to
rebuild and reinvoke `quicktype` as you implement your renderer:

```shell
$ npm start -- "--lang fortran test/inputs/json/samples/bitcoin-block.json"
```

The command in quotes is passed to `quicktype`, so you can render local `.json`
files, URLs, or add other options.

## Test

```shell
$ npm test
```

### Requirements

* [`dotnetcore`](https://www.microsoft.com/net/core#macos)
* [Maven](https://maven.apache.org/) (for example via
  [Homebrew](https://brew.sh))

On macOS the system Java seems sufficient to run tests.

### Test only a specific fixture

```shell
$ FIXTURE=golang npm test
```

### Using Docker

```shell
$ docker build --cache-from dvdsgl/quicktype -t quicktype .
$ docker run -t quicktype npm test
$ # run specific fixtures
$ docker run -t quicktype sh -c "FIXTURE=golang,java npm test"
```
