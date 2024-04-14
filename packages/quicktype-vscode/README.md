**Supports** `C (cJSON)`, `C#`, `C++`, `Crystal`, `Dart`, `Elm`, `Flow`, `Go`, `Haskell`, `JSON Schema`, `Java`, `JavaScript`, `JavaScript PropTypes`, `Kotlin`, `Objective-C`, `PHP`, `Pike`, `Python`, `Ruby`, `Rust`, `Scala3`, `Smithy`, `Swift`, `TypeScript`, `TypeScript Effect Schema` and `TypeScript Zod`

-   Interactively generate types and (de-)serialization code from JSON, JSON Schema, and TypeScript
-   Paste JSON/JSON Schema/TypeScript as code

![](https://raw.githubusercontent.com/quicktype/quicktype-vscode/master/media/demo-interactive.gif)

`quicktype` infers types from sample JSON data, then outputs strongly typed models and serializers for working with that data in your desired programming language. For more explanation, read [A first look at quicktype](http://blog.quicktype.io/first-look/).

In any JSON file, use the command "Open quicktype for JSON" to summon quicktype, which will generate types from the JSON. Invoke "Change quicktype's target language" to pick a different language. There are similar "Open quicktype" commands for JSON Schema and TypeScript.

Another way to use quicktype is to copy JSON into the clipboard and invoke "Paste JSON as code/types":

![](https://raw.githubusercontent.com/quicktype/quicktype-vscode/master/media/demo.gif)

For a more powerful experience, including custom options and the ability to generate code from multiple JSON samples, try [quicktype.io](https://app.quicktype.io).

## Installing

This extension is available for free in the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items/quicktype.quicktype)

## Customization

-   `quicktype.justTypes`: Generate only types, or also produce (de)serialization code when using "Open quicktype". When using "Paste", you can pick between the commands for "types" and "code", without having to set this option.

-   `quicktype.inferMaps`, `quicktype.inferEnums`, `quicktype.inferDateTimes`, `quicktype.inferUuids`, `quicktype.inferBoolStrings`, `quicktype.inferIntegerStrings`: Tell quicktype whether it should try to infer those types from the input JSON. This is not a precise science, so sometimes the guess will be wrong, which is why you can turn them off through these options. Also, quicktype doesn't support dates, UUIDs and stringified integers/booleans in all target languages yet.

## Contribute!

quicktype is an open source project, and we're always happy about contributors. If you can think of a way to improve [this extension](https://github.com/quicktype/quicktype-vscode), or [quicktype](https://github.com/quicktype/quicktype), please consider contributing, especially if you know TypeScript. Code is only one way to contribute, though: we're particularly short on documentation. We'd also love to hear your feedback - come [talk to us on Slack](http://slack.quicktype.io)!

If you find a bug, please [report it on GitHub](https://github.com/quicktype/quicktype-vscode/issues).
