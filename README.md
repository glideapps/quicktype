![](quicktype-logo.svg)

[![npm version](https://badge.fury.io/js/quicktype.svg)](https://badge.fury.io/js/quicktype)
[![Build Status](https://travis-ci.org/quicktype/quicktype.svg?branch=master)](https://travis-ci.org/quicktype/quicktype)
[![Join us in Slack](http://slack.quicktype.io/badge.svg)](http://slack.quicktype.io/)

`quicktype` infers types from sample JSON data, then outputs strongly typed models and serializers for working with that data in your desired programming language. In short, quicktype makes it a breeze to work with JSON type-safely. For more explanation, read [A first look at quicktype](http://blog.quicktype.io/first-look/).

### Supported Input Languages

* JSON
* JSON Schema
* GraphQL queries
* JSON URLs

### Supported Output Languages

* C#
* Go
* C++
* Java
* TypeScript
* Swift
* Elm
* JSON Schema
* Simple Types

---

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

`quicktype` has a lot of complicated test dependencies:

* `swift` compiler
* `dotnetcore` SDK
* Java, Maven
* `elm` tools
* `g++` C++ compiler
* `golang` stack

We've assembled all of these tools in a Docker container that you build and test within:

```shell
$ script/dev
# ... Docker will build the image and start a bash shell
$ npm run test
```

### Test only a specific fixture

```shell
$ FIXTURE=golang npm test
```
