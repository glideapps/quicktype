# Quicktype Options Mapping Guide

This document maps `quicktype` command-line interface (CLI) flags to their corresponding programmatic options in JavaScript and TypeScript.

When using `quicktype` programmatically via the `quicktype()` or `quicktypeMultiFile()` functions in Node.js/TypeScript, options are supplied through the `Options` object (exported from `quicktype-core`). Target-language-specific CLI flags are passed inside the `rendererOptions` dictionary property.

---

## Core & General Options

| CLI Flag | JS/TS Property | Description |
| --- | --- | --- |
| `-o, --out <FILE>` | `outputFilename` | Name of the output file. Determines target language and top-level type name if not explicitly specified. |
| `-l, --lang <LANG>` | `lang` | The target programming language (e.g., `ts`, `csharp`, `go`, `swift`, `python`, `java`, `rust`, etc.). |
| `-t, --top-level <NAME>` | `topLevel` | Top-level type name generated for the root input object. |
| `-s, --src-lang <SRC_LANG>` | `srcLang` | Input source format (`json`, `schema`, `graphql`, `postman`, `typescript`). Defaults to `json`. |
| `--src <FILE\|URL\|DIR>` | `inputData` | Input files, URLs, or directories containing sample JSON or schema definitions. |
| `--src-urls <FILE>` | `srcUrls` | Path to a Tracery grammar file describing URLs to crawl for data samples. |
| `--alphabetize-properties` | `alphabetizeProperties` | Put class and interface properties in alphabetical order instead of original JSON order. |
| `--all-properties-optional` | `allPropertiesOptional` | Make all properties in generated classes/interfaces optional (`undefined` / nullable). |
| `--no-render` | `noRender` | Do not render final code output. Useful for performance benchmarking or validation. |

---

## Type Inference Flags

`quicktype` performs smart type inference on JSON sample data by default. The CLI provides `--no-*` flags to disable specific inference behaviors. In the JS/TS API, these correspond to boolean properties that default to `true`.

| CLI Flag | JS/TS Property | Description |
| --- | --- | --- |
| `--no-maps` | `inferMaps` (default: `true`) | Prevent inferring map/dictionary types from JSON objects; always generate explicit classes/structs. |
| `--no-enums` | `inferEnums` (default: `true`) | Prevent inferring enum types from repeated string field values; keep them as plain strings. |
| `--no-uuids` | `inferUuids` (default: `true`) | Prevent converting UUID-formatted strings to native UUID/GUID types. |
| `--no-date-times` | `inferDateTimes` (default: `true`) | Prevent inferring ISO date/time types from date-formatted string values. |
| `--no-integer-strings` | `inferIntegerStrings` (default: `true`) | Prevent automatically parsing numeric strings (e.g., `"123"`) as integer types. |
| `--no-boolean-strings` | `inferBooleanStrings` (default: `true`) | Prevent automatically parsing boolean strings (e.g., `"true"`, `"false"`) as boolean types. |
| `--no-combine-classes` | `combineClasses` (default: `true`) | Prevent combining structurally similar inferred classes into a shared class type. |
| `--no-ignore-json-refs` | `ignoreJsonRefs` (default: `true`) | Treat `$ref` properties as schema references inside JSON input files. |

---

## Schema & GraphQL Options

| CLI Flag | JS/TS Property | Description |
| --- | --- | --- |
| `-S, --additional-schema <FILE>` | `additionalSchema` | Register `$id` URIs of additional JSON Schema files for resolving cross-schema references. |
| `--graphql-schema <FILE>` | `graphqlSchema` | Path to a GraphQL schema file or saved GraphQL introspection result. |
| `--graphql-introspect <URL>` | `graphqlIntrospect` | Server endpoint URL to run a GraphQL introspection query against. |
| `--http-method <METHOD>` | `httpMethod` | HTTP method (e.g., `POST`, `GET`) to use for GraphQL introspection requests. |
| `--http-header <HEADER>` | `httpHeader` | Custom HTTP headers (in `Header: Value` format) for remote HTTP/GraphQL requests. |

---

## Target Language Renderer Options

Target language-specific flags are passed in JS/TS using the `rendererOptions` key-value object inside the main `Options` payload.

| CLI Flag | JS/TS Property | Description |
| --- | --- | --- |
| `--just-types` | `rendererOptions["just-types"]` | Generate plain type definitions/interfaces only, excluding serialization and deserialization helpers. |
| `--acronym-style <STYLE>` | `rendererOptions["acronym-style"]` | Acronym casing strategy (`original`, `pascal`, `camel`, `lower-case`). |
| `--dense` | `rendererOptions["dense"]` | Produce dense output with reduced whitespace where supported by the language renderer. |
| `--pad-empty-lines` | `rendererOptions["pad-empty-lines"]` | Pad empty lines with whitespace matching surrounding indentation level. |
| `--explicit-unions` | `rendererOptions["explicit-unions"]` | Explicitly name union types instead of rendering inline union types. |

---

## Debug & Diagnostic Options

| CLI Flag | JS/TS Property | Description |
| --- | --- | --- |
| `--debug <OPTIONS>` | `debugPrintGraph`, `debugPrintTimes`, etc. | Enable verbose internal debugging flags (comma-separated: `print-graph`, `print-reconstitution`, `print-gather-names`, `print-transformations`, `print-schema-resolving`, `print-times`, `provenance`). |
| `--telemetry <enable\|disable>` | `telemetry` | Enable or disable anonymous telemetry reporting. |
| `--quiet` | `quiet` | Suppress warnings and non-fatal issue output during code generation. |
| `--build-markov-chain <FILE>` | `buildMarkovChain` | Specify a corpus filename to train Markov chain heuristics for class vs. map detection. |
| `-h, --help` | `help` | Display command-line help usage instructions. |
| `-v, --version` | `version` | Output the installed version of `quicktype`. |
