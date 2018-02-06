![](quicktype-logo.svg)

[![npm version](https://badge.fury.io/js/quicktype.svg)](https://badge.fury.io/js/quicktype)
[![Build Status](https://travis-ci.org/quicktype/quicktype.svg?branch=master)](https://travis-ci.org/quicktype/quicktype)
[![Join us in Slack](http://slack.quicktype.io/badge.svg)](http://slack.quicktype.io/)

`quicktype` generates strongly-typed models and serializers from JSON, JSON Schema, and [GraphQL queries](https://blog.quicktype.io/graphql-with-quicktype/), making it a breeze to work with JSON type-safely in any programming language.

* [Try `quicktype` in your browser](https://app.quicktype.io).
* View [awesome JSON APIs](https://github.com/typeguard/awesome-typed-datasets) that have been strongly typed with `quicktype`.
* Read ['A first look at quicktype'](http://blog.quicktype.io/first-look/) for more introduction.

### Supported Inputs

* JSON
* JSON API URLs
* JSON Schema
* GraphQL queries

### Target Languages

* C#
* Go
* C++
* Java
* TypeScript
* Swift
* Objective-C
* Elm
* JSON Schema
* Simple Types (pseudo-code)

_Missing your favorite language? Please implement it!_

---

## Installation

There are many ways to use `quicktype`. [app.quicktype.io](https://app.quicktype.io) is the most powerful & complete UI. The web app also works offline and doesn't send your sample data over the Internet, so paste away!

For the best CLI, we recommend installing `quicktype` globally via `npm`:

```bash
npm install -g quicktype
```

Other options:

* [Homebrew](http://formulae.brew.sh/formula/quicktype) _(infrequently updated)_
* [Xcode extension](https://itunes.apple.com/us/app/paste-json-as-code-quicktype/id1330801220?mt=12)\*
* [VSCode extension](https://marketplace.visualstudio.com/items/quicktype.quicktype)\*
* [Visual Studio extension](https://marketplace.visualstudio.com/items?itemName=typeguard.quicktype-vs)\*

<small>\* limited functionality</small>

## Using `quicktype`

```bash
# Run quicktype without arguments for help and options
quicktype

# quicktype a simple JSON object in C#
echo '{ "name": "David" }' | quicktype -l csharp

# quicktype a top-level array and save as Go source
echo '[1, 2, 3]' | quicktype -o ints.go

# quicktype a sample JSON file in Swift
quicktype person.json -o Person.swift

# A verbose way to do the same thing
quicktype \
  --src person.json \
  --src-lang json \
  --lang swift \
  --top-level Person \
  --out Person.swift

# quicktype a directory of samples as a C++ program
# Suppose ./blockchain is a directory with files:
#   latest-block.json transactions.json marketcap.json
quicktype ./blockchain -o blockchain-api.cpp

# quicktype a live JSON API as a Java program
quicktype https://api.somewhere.com/data -o Data.java
```

The recommended way to use `quicktype` is to generate a JSON schema from sample data, review and edit the schema, commit the schema to your project repo, then generate code from the schema as part of your build process:

```bash
# First, infer a JSON schema from a sample.
quicktype pokedex.json -o schema.json

# Review the schema, make changes,
# and commit it to your project repo.

# Finally, generate model code from schema in your
# build process for whatever languages you need:
quicktype -s schema schema.json -o src/ios/models.swift
quicktype -s schema schema.json -o src/android/Models.java
quicktype -s schema schema.json -o src/nodejs/Models.ts

# All of these models will serialize to and from the same
# JSON, so different programs in your stack can communicate
# seamlessly.
```

## Development

`quicktype` is open source so if you'd like additional options or a new target language, you can build it yourself and send a pull request. `quicktype` is implemented in TypeScript and requires `nodejs` and `npm` to build and run.

### Setup, Build, Run

Clone this repo and do:

```bash
npm install
script/quicktype # rebuild (slow) and run (fast)
```

### Edit

Install [Visual Studio Code](https://code.visualstudio.com/), open this
workspace, and install the recommended extensions:

```bash
code . # opens in VS Code
```

### Live-reloading for quick feedback

When working on an output language, you'll want to view generated
output as you edit. Use `npm start` to watch for changes and
recompile and rerun `quicktype` for live feedback. For example, if you're
developing a new renderer for `fortran`, you could use the following command to
rebuild and reinvoke `quicktype` as you implement your renderer:

```bash
npm start -- "--lang fortran pokedex.json"
```

The command in quotes is passed to `quicktype`, so you can render local `.json`
files, URLs, or add other options.

### Test

`quicktype` has many complex test dependencies:

* `dotnetcore` SDK
* Java, Maven
* `elm` tools
* `g++` C++ compiler
* `golang` stack
* `swift` compiler
* `clang` and Objective-C Foundation (must be tested separately on macOS)

We've assembled all of these tools in a Docker container that you build and test within:

```bash
# Build and attach to Docker container
script/dev

# Run full test suite
npm run test

# Test a specific language (see test/languages.ts)
FIXTURE=golang npm test

# Test a single sample or directory
FIXTURE=swift npm test -- pokedex.json
FIXTURE=swift npm test -- test/inputs/json/samples
```
