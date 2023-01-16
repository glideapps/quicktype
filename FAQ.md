# The quicktype FAQ

-   [What is this?](#what-is-this)
-   [How does this work?](#how-does-this-work)
-   [How do I use this with my code?](#how-do-i-use-this-with-my-code)
-   [No code appears when I paste my JSON](#why-does-quicktype-complain-about-my-json)
-   [I think I found a bug!](#i-think-i-found-a-bug)
-   [When will you support my favorite language?](#when-will-you-support-my-favorite-language)
-   [Why do my types have weird names?](#why-do-my-types-have-weird-names)
-   [I'd like the output to be a little different.](#id-like-the-output-to-be-a-little-different)
-   [Am I allowed to use the generated code in my software?](#am-i-allowed-to-use-the-generated-code-in-my-software)
-   [This map/dictionary should be a class!](#this-mapdictionary-should-be-a-class)
-   [This class should be a map/dictionary!](#this-class-should-be-a-mapdictionary)
-   [Where can I learn more about JSON Schema?](#where-can-i-learn-more-about-json-schema)
-   [I'd like to customize the output for my particular application.](#id-like-to-customize-the-output-for-my-particular-application)
-   [How can I control the property order in JSON Schema?](#how-can-i-control-the-property-order-in-json-schema)
-   [quicktype is awesome, I'd like to support it!](#quicktype-is-awesome-id-like-to-support-it)
-   [How is this different from other JSON converters?](#how-is-quicktype-different-from-other-json-converters)

## What is this?

[quicktype](https://app.quicktype.io) produces nice types and JSON (de)serializers for many programming languages. It can infer types from JSON but also takes types from JSON Schema, TypeScript, and GraphQL.

## How does this work?

You paste JSON on the left, and code appears on the right. [This video](https://www.youtube.com/watch?v=19bMU7jZ27w) gives a quick demonstration.

## How is this different from other JSON converters?

`quicktype` is superior to other JSON converters in many important ways:

-   **Type inference**: quicktype infers optionals, dates, UUIDs, enums, integers, and unions. It also infers maps (versus objects) using a Markov chain.
-   **Careful naming**: quicktype’s naming system creates nice, legal, unique names for types and properties, handling reserved words and tricky corner cases (e.g. `{ “”: “this is legal”, “null”: “so is this”, "1;DROP TABLE users”: “and this" }`).
-   **Heterogeneous data**: JSON data is often heterogenous. quicktype infers this, and creates union types in languages that support them, or synthetic union types in languages that don’t (e.g. try quicktyping `[0, “zero”]` as Swift and Go).
-   **Type unification**. This works across multiple samples, so you can quicktype a directory of API data, for example, and unify types across all responses (e.g. you’ll get just one `Customer` type, even if customer data occurs in many samples). You can also provide multiple samples for the same type for better coverage.
-   **Marshalling code**: In addition to types, quicktype generates functions for marshalling your types to and from JSON.
-   Supports dynamic languages: quicktype can add dynamic typechecks for JavaScript, TypeScript, Flow, Python, and Ruby.
-   **Convenient CLI**: Run `quicktype https://blockchain.info/latestblock -o LatestBlock.ts` to quicktype a Bitcoin API in TypeScript.
-   **Client-side**: [The web version of quicktype](https://app.quicktype.io/) runs on the client, so servers never see your data (most JSON converters send your JSON to their server)
-   **Typed input**: Feed quicktype TypeScript or JSON Schema instead of JSON for better control over generated types.
-   **Code quality**: quicktype emits clean code

## How do I use this with my code?

The generated code has comments at the start with a short code sample that shows how to convert a JSON string to instances of the generated types. You can also go the other way, which is very easy, too, but you'll have to look at the generated code to see how it works.

## No code appears when I paste my JSON

This is probably because your JSON is invalid. The most common issues we're seeing are

-   Trailing commas in arrays and objects: `[1, 2, 3]` is valid JSON, while `[1, 2, 3,]` is not.

-   Unquoted property keys in objects: `{ "name": "Mark" }` is valid JSON, while `{ name: "Mark" }` is not.

-   Comments: JSON does not support comments.

If you're unsure whether your JSON is valid, please use [JSONLint](https://jsonlint.com).

## I think I found a bug!

Please [file an issue on GitHub](https://github.com/quicktype/quicktype/issues). Give as much context as you can so that we can reproduce it. Assume we know nothing about what you're trying to do (because we don't).

## When will you support my favorite language?

Please check whether there is [a pull request](https://github.com/quicktype/quicktype/pulls) that adds support for your language. If there is, please consider helping it along. If there isn't, please consider contributing one.

## Why do my types have weird names?

Sometimes quicktype has trouble giving names to your types. There are a couple of causes for this:

-   The name quicktype would like to give to your type conflicts with a name that's already used in the target language, such as `String` in C#.

-   Two or more types in your data have the same name.

-   A type has so many potential names that quicktype can't find a commonality between them.

If you're using JSON Schema, you can use the `title` property to give a type a name that quicktype tries hard to use.

## I'd like the output to be a little different.

Check out the "Language" and "Other" tabs in the options panel. What you're looking for might just be there:

<img width="33%" height="33%" alt="Screenshot showing the options panel" src="https://raw.githubusercontent.com/quicktype/quicktype/master/media/faq/options-panel.png" />

If it isn't, then depending on your coding skills, you might be able to [customize the output](https://blog.quicktype.io/customizing-quicktype/).

## Am I allowed to use the generated code in my software?

Yes, there are no intellectual property restrictions on the code that quicktype generates.

## This map/dictionary should be a class!

quicktype has [advanced heuristics](https://blog.quicktype.io/markov/) to decide whether a JSON object should be represented by a class or a map, but sometimes it gets it wrong. If it generates a map, but you'd rather have a class, you can disable map detection in the options panel:

<img width="66%" height="66%" alt="Screenshot showing the 'Detect maps' switch in the options panel" src="https://raw.githubusercontent.com/quicktype/quicktype/master/media/faq/disable-detect-maps.png" />

## This class should be a map/dictionary!

quicktype has [advanced heuristics](https://blog.quicktype.io/markov/) to decide whether a JSON object should be represented by a class or a map, but sometimes it gets it wrong. If it generates a class, but you need a map, first make sure that you have the "Detect maps" option set in the options panel. Also, check that all properties in the object have the same exact type because quicktype only makes a map if that's the case. If that still doesn't do it, you have two options:

-   Duplicate some of the properties and/or change the property names to look more random.

-   Output JSON Schema, modify it to produce a map, and then use the schema as the input to quicktype.

## Where can I learn more about JSON Schema?

The [JSON Schema homepage](http://json-schema.org) contains many links and resources.

## I'd like to customize the output for my particular application.

We have [a blog post](https://blog.quicktype.io/customizing-quicktype/) on that very topic.

## How can I control the property order in JSON Schema?

There is a custom schema field `quicktypePropertyOrder` which can be used to specify the order of properties for quicktype.

For example:

```json
  ...
  "Location": {
    "quicktypePropertyOrder": [ "latitude", "longitude" ],
    "type": "object",
    "properties": {
      "latitude": {
        "type": "number",
        "description": "The latitude component of the location",
        "example": -32.204754
      },
      ...
    },
    "required": [ "latitude", "longitude" ]
  },
  ...
```

## quicktype is awesome, I'd like to support it!

There are many ways you can support quicktype:

-   Tell all your friends about it! Show it around, tweet about it, write a blog post, present it at a lightning talk.

-   quicktype is open source - please contribute! We need documentation at least as much as code, so you don't need strong coding skills to make an impact. If you do, we have [lots of open issues](https://github.com/quicktype/quicktype/issues) that need resolving, almost all of our target languages can be improved, and there are many, many programming languages that quicktype doesn't support yet. Talk to us [on Slack](http://slack.quicktype.io) if you're interested - we're always happy to help.
