![](https://raw.githubusercontent.com/quicktype/quicktype/master/media/quicktype-logo.svg?sanitize=true)

[![npm version](https://badge.fury.io/js/quicktype.svg)](https://badge.fury.io/js/quicktype)
![Build status](https://github.com/quicktype/quicktype/actions/workflows/master.yaml/badge.svg)

`quicktype` generates strongly-typed models and serializers from JSON, JSON Schema, TypeScript, and [GraphQL queries](https://blog.quicktype.io/graphql-with-quicktype/), making it a breeze to work with JSON type-safely in many programming languages.

-   [Try `quicktype` in your browser](https://app.quicktype.io).
-   Read ['A first look at quicktype'](http://blog.quicktype.io/first-look/) for more introduction.
-   If you have any questions, check out the [FAQ](FAQ.md) first.

### Supported Inputs

| JSON | JSON API URLs | [JSON Schema](https://app.quicktype.io/#s=coordinate) |
| ---- | ------------- | ----------------------------------------------------- |

| TypeScript | GraphQL queries |
| ---------- | --------------- |

### Target Languages

| [Ruby](https://app.quicktype.io/#l=ruby) | [JavaScript](https://app.quicktype.io/#l=js) | [Flow](https://app.quicktype.io/#l=flow) | [Rust](https://app.quicktype.io/#l=rust) | [Kotlin](https://app.quicktype.io/#l=kotlin) |
| ---------------------------------------- | -------------------------------------------- | ---------------------------------------- | ---------------------------------------- | -------------------------------------------- |

| [Dart](https://app.quicktype.io/#l=dart) | [Python](https://app.quicktype.io/#l=python) | [C#](https://app.quicktype.io/#l=cs) | [Go](https://app.quicktype.io/#l=go) | [C++](https://app.quicktype.io/#l=cpp) |
| ---------------------------------------- | -------------------------------------------- | ------------------------------------ | ------------------------------------ | -------------------------------------- |

| [Java](https://app.quicktype.io/#l=java) | [Scala](https://app.quicktype.io/#l=scala3) | [TypeScript](https://app.quicktype.io/#l=ts) | [Swift](https://app.quicktype.io/#l=swift) | [Objective-C](https://app.quicktype.io/#l=objc) | [Elm](https://app.quicktype.io/#l=elm) |
| ---------------------------------------- | ------------------------------------------- | -------------------------------------------- | ------------------------------------------ | ----------------------------------------------- | -------------------------------------- |

| [JSON Schema](https://app.quicktype.io/#l=schema) | [Pike](https://app.quicktype.io/#l=pike) | [Prop-Types](https://app.quicktype.io/#l=javascript-prop-types) | [Haskell](https://app.quicktype.io/#l=haskell) | [PHP](https://app.quicktype.io/#l=php) |
| ------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------- |

_Missing your favorite language? Please implement it!_

## Installation

There are many ways to use `quicktype`. [app.quicktype.io](https://app.quicktype.io) is the most powerful and complete UI. The web app also works offline and doesn't send your sample data over the Internet, so paste away!

For the best CLI, we recommend installing `quicktype` globally via `npm`:

```bash
npm install -g quicktype
```

Other options:

-   [Homebrew](http://formulae.brew.sh/formula/quicktype) _(infrequently updated)_
-   [Xcode extension](https://itunes.apple.com/us/app/paste-json-as-code-quicktype/id1330801220?mt=12)\*
-   [VSCode extension](https://marketplace.visualstudio.com/items/quicktype.quicktype)\*
-   [Visual Studio extension](https://marketplace.visualstudio.com/items?itemName=typeguard.quicktype-vs)\*

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

### Generating code from JSON schema

The recommended way to use `quicktype` is to generate a JSON schema from sample data, review and edit the schema, commit the schema to your project repo, then generate code from the schema as part of your build process:

```bash
# First, infer a JSON schema from a sample.
quicktype pokedex.json -l schema -o schema.json

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

### Generating code from TypeScript (Experimental)

You can achieve a similar result by writing or generating a [TypeScript](http://www.typescriptlang.org/) file, then quicktyping it. TypeScript is a typed superset of JavaScript with simple, succinct syntax for defining types:

```typescript
interface Person {
    name: string;
    nickname?: string; // an optional property
    luckyNumber: number;
}
```

You can use TypeScript just like JSON schema was used in the last example:

```bash
# First, infer a TypeScript file from a sample (or just write one!)
quicktype pokedex.json -o pokedex.ts --just-types
# Review the TypeScript, make changes, etc.
quicktype pokedex.ts -o src/ios/models.swift
```

### Calling `quicktype` from JavaScript

You can use `quicktype` as a JavaScript function within `node` or browsers. First add the `quicktype-core` package:

```bash
$ npm install quicktype-core
```

In general, first you create an `InputData` value with one or more JSON samples, JSON schemas, TypeScript sources, or other supported input types. Then you call `quicktype`, passing that `InputData` value and any options you want.

```javascript
import {
    quicktype,
    InputData,
    jsonInputForTargetLanguage,
    JSONSchemaInput,
    FetchingJSONSchemaStore
} from "quicktype-core";

async function quicktypeJSON(targetLanguage, typeName, jsonString) {
    const jsonInput = jsonInputForTargetLanguage(targetLanguage);

    // We could add multiple samples for the same desired
    // type, or many sources for other types. Here we're
    // just making one type from one piece of sample JSON.
    await jsonInput.addSource({
        name: typeName,
        samples: [jsonString]
    });

    const inputData = new InputData();
    inputData.addInput(jsonInput);

    return await quicktype({
        inputData,
        lang: targetLanguage
    });
}

async function quicktypeJSONSchema(targetLanguage, typeName, jsonSchemaString) {
    const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());

    // We could add multiple schemas for multiple types,
    // but here we're just making one type from JSON schema.
    await schemaInput.addSource({ name: typeName, schema: jsonSchemaString });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    return await quicktype({
        inputData,
        lang: targetLanguage
    });
}

async function main() {
    const { lines: swiftPerson } = await quicktypeJSON("swift", "Person", jsonString);
    console.log(swiftPerson.join("\n"));

    const { lines: pythonPerson } = await quicktypeJSONSchema("python", "Person", jsonSchemaString);
    console.log(pythonPerson.join("\n"));
}

main();
```

The argument to `quicktype` is a complex object with many optional properties. [Explore its definition](https://github.com/quicktype/quicktype/blob/master/packages/quicktype-core/src/Run.ts#L637) to understand what options are allowed.

## Contributing

`quicktype` is [Open Source](LICENSE) and we love contributors! In fact, we have a [list of issues](https://github.com/quicktype/quicktype/issues?utf8=✓&q=is%3Aissue+is%3Aopen+label%3Ahelp-wanted) that are low-priority for us, but for which we'd happily accept contributions. Support for new target languages is also strongly desired. If you'd like to contribute, need help with anything at all, or would just like to talk things over, come [join us on Slack](http://slack.quicktype.io/).

### Setup, Build, Run

`quicktype` is implemented in TypeScript and requires `nodejs` and `npm` to build and run.

First, install `typescript` globally via `npm`:

Clone this repo and do:

#### macOS / Linux

```bash
nvm use
npm install
script/quicktype # rebuild (slow) and run (fast)
```

#### Windows

```bash
npm install --ignore-scripts # Install dependencies
npm install -g typescript # Install typescript globally
tsc --project src/cli # Rebuild
node dist\cli\index.js # Run
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

```bash
# Run full test suite
npm run test

# Test a specific language (see test/languages.ts)
FIXTURE=golang npm test

# Test a single sample or directory
FIXTURE=swift npm test -- pokedex.json
FIXTURE=swift npm test -- test/inputs/json/samples
```
