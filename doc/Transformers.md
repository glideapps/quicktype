# Transformed string types

quicktype has facilities for transforming JSON strings into other data types, provided a given target language implementation supports it. Right now the most advanced target language in that regard is C#, which supports data/time types and stringified integers.

There are two different sorts of transformed string types:

-   Those that transform strings into other JSON-representable types, such as stringified integers.

-   Those that transform into types that are not directly representable in JSON (other than as strings), such as date/time types.

Several pieces need to be implemented to add a new transformed string type:

1.  `TransformedStringTypeTargets` have to be added for the new type kind in the object `transformedStringTypeTargetTypeKinds` in `Type.ts`. The property names of that object are the internal primitive type names. Adding a new property automatically adds a new type.

2.  `inferTransformedStringTypeKindForString` in `StringTypes.ts` can optionally be amended to automatically infer the new transformed type from a given string in JSON input. If this isn't done, the only way to use the new type is through JSON Schema. If it is done, a CLI option to turn it off has to be added. This is currently still more complicated than it needs to be, since it also involves changing the options to `quicktype-core`.

3.  The target languages that should support the new type have to be amended. Currently C# is the only one that allows this easily. See `CSharp.ts` and search for `date-time`.

4.  Test cases have to be added. See `test/inputs/schema/date-time*`, for example. If JSON inference is implemented, there should be at least one JSON test file with a string of that type.

5.  In `fixtures.ts`, `ajv`, which we use to validate JSON against schemas, has to be told about the new JSON Schema string format. Search for `date-time`.

## Stuff we need to improve

-   Automatic generation of tests. We should have a test generator that produces test files with all string types in all reasonable combinations.

-   One CLI option for all string types. No CLI option work should be necessary to implement a new string type.

-   The AJV thing should be automated, too. We have almost all the validation code necessary in `StringTypes.ts` anyway.
