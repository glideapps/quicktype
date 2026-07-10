# Migrating to quicktype 24

quicktype 24 raises the minimum supported Node.js version to Node 20. The
project itself is built, tested, and published with Node 24, while CI also
builds and tests the supported Node 20 floor.

The CLI and published libraries now use the native `fetch` implementation
provided by Node.js and modern browsers. Applications running quicktype on a
supported Node.js version do not need to install or configure a fetch
polyfill.

There are no intentional changes to generated code or the public quicktype
API in this release. TypeScript compiler versions are also unchanged. Note,
however, that TypeScript consumers upgrading from quicktype-core 23.0.x or
earlier will encounter the stricter language-name typing described below,
which was introduced in 23.1.0.

## Stricter language-name typing in quicktype-core

Since quicktype-core 23.1.0, the `lang` option of `quicktype()` and the
first parameter of `jsonInputForTargetLanguage()` are typed as
`LanguageName | TargetLanguage` instead of `string | TargetLanguage`.
`LanguageName` is a union of all the language names quicktype supports, so
typos in language names are now caught at compile time. Runtime behavior is
unchanged.

TypeScript code that wraps quicktype in a helper taking `targetLanguage:
string` — like older versions of the README sample — no longer typechecks,
failing with errors such as:

```
error TS2345: Argument of type 'string' is not assignable to parameter of
type '"ruby" | TargetLanguage<LanguageConfig> | "cjson" | ...'.
```

To migrate, either type the language parameter as `LanguageName`:

```typescript
import { type LanguageName } from "quicktype-core";

async function quicktypeJSON(targetLanguage: LanguageName, ...) { ... }
```

or, if the language name is a `string` only known at runtime, narrow it
with the `isLanguageName` type guard, which accepts everything quicktype
itself accepts (canonical names like `"csharp"`, display names like `"C#"`,
and file extensions like `"cs"`):

```typescript
import { isLanguageName } from "quicktype-core";

if (!isLanguageName(maybeLanguage)) {
    throw new Error(`Unknown target language: ${maybeLanguage}`);
}
// maybeLanguage is now a LanguageName
```

Alternatively, `languageNamed(name)` looks up the `TargetLanguage` instance
for a name, returning `undefined` if there is none; an instance can be
passed anywhere a language name is accepted.

See the [README](README.md#calling-quicktype-from-javascript) for a
complete, up-to-date usage sample.

## Testing

For contributors, `npm run test:unit` runs the Vitest regression suite and
`npm run test:fixtures` runs the cross-language fixture harness. `npm test`
runs both suites.
