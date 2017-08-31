[![Build Status](https://travis-ci.com/dvdsgl/quicktype.svg?token=PSTj9tVyM1RDRiZ17Sgd&branch=master)](https://travis-ci.com/dvdsgl/quicktype)

## Setup

```shell
$ npm install
```

## Build

```shell
$ npm run build
```

## Live-reloading for quick feedback

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
