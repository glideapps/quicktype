# JSON Schema comment injection

## TypeScript reproduction

Added a focused schema fixture:

- `test/inputs/schema/comment-injection.schema`
- `test/inputs/schema/comment-injection.1.json`

The schema puts comment-closing text in both an object `description` and a property `description`:

- `*/` and `/*` for C-style block comments (the opener matters for Kotlin and Scala 3, whose block comments nest)
- `{-` and `-}` for Elm/Haskell comments
- `"""` on its own line for Python/Elixir docstrings/heredocs
- `</summary> & <br>` for C# XML doc comments
- `\r}`, `\u0085}`, `\u2028}`, and `\u2029}` for line-comment outputs whose lexers treat CR, NEL, LINE SEPARATOR, or PARAGRAPH SEPARATOR as line terminators
- property descriptions ending in `\`, `"`, and `"""` for docstring/heredoc delimiter boundaries and C-family line splicing

Run:

```bash
CPUs=1 QUICKTEST=true FIXTURE=schema-typescript npm test -- test/inputs/schema/comment-injection.schema
```

Expected result: the generated TypeScript validates `comment-injection.1.json` and prints equivalent JSON.

Before escaping was added, this test failed before validation because `TopLevel.ts` was syntactically invalid; the schema `description` escaped the generated `/** ... */` comment.

## Schema fields that can reach comments

In JSON Schema input, `packages/quicktype-core/src/attributes/Description.ts` collects `description` into type and property-description attributes. Renderers then emit those attributes as documentation comments.

Observed comment sinks:

- schema/type `description` on objects/classes
- property `description` for object properties/fields
- `description` on enum schemas
- `description` on union schemas and other named types when a renderer emits docs for those named types

`title` is different in the inspected path: JSON Schema input uses it for type/top-level naming, not as raw documentation text. The generated JSON Schema renderer can output JSON `title` fields, but those are JSON string values, not source comments.

Other non-schema inputs can also supply descriptions or leading comments, but the reproduction here is limited to JSON Schema `description`.

## Potentially affected outputs and triggers

Outputs are affected when raw schema descriptions are placed into comments/docstrings without escaping that target's comment delimiter or line terminators. The shared fix now normalizes description line endings and escapes delimiter text at comment-emission time.

- C-style doc comments `/** ... */`: TypeScript, Flow, JavaScript when descriptions are emitted, Java, C (`cjson`), C++, PHP, Kotlin, Scala 3, Smithy4s. Trigger with `*/`; escaped as `* /`. The opener `/*` is escaped as `/ *`, too, because Kotlin and Scala 3 nest block comments, so an unmatched opener would swallow the rest of the file.
- Elm/Haskell doc comments `{-| ... -}`: Elm, Haskell. Trigger with `{-` or `-}`; escaped as `{ -` and `- }`.
- Triple-quoted docstrings/heredocs: Python, Elixir. These are string literals, so three separate escapes apply: `"""` is escaped as `\"\"\"`, backslashes are doubled (otherwise a description ending in `\` swallows the first quote of the closing delimiter), and a line-ending unescaped `"` directly before an inline closing `"""` is escaped as `\"` (otherwise four quotes in a row leave a stray quote after the closing delimiter).
- XML doc comments `/// <summary>`: C#. Trigger with `</summary>`, `<`, or `&`; escaped as XML entities (`&lt;`, `&gt;`, `&amp;`) in both the regular and `--density dense` paths.
- Line comments (`//`, `///`): C#, Go, Rust, Ruby, Swift, Objective-C, Dart, Pike, Crystal, and enum comments in TypeScript-Zod/TypeScript-Effect-Schema. Trigger with a carriage return (`\r`) — or U+0085/U+2028/U+2029, which JavaScript and C# lexers also treat as line terminators — when descriptions are split only on `\n`; fixed by normalizing all of them to `\n` before comment emission.
- C-family line splicing: C, C++, and Objective-C splice a backslash-newline into one line even inside comments, so a description ending in `\` pulls the next generated line into the comment (and trips `-Wcomment` under `-Werror`). Fixed by appending `.` after a comment line's trailing backslash in those renderers.

Plain JavaScript output did not emit the tested schema descriptions into model comments, so the object/property reproduction does not affect it the same way. TypeScript-Zod and TypeScript-Effect-Schema also did not emit the object/property descriptions from `comment-injection.schema`; they only emitted the enum description from `comment-injection-enum.schema`.

The tree-sitter fixture includes Go, Rust, and Ruby even though their grammars did not reproduce a syntax break with the CR line-comment payload; this keeps parser coverage in place for those generated outputs and future payload/escaping changes.

Still not covered by the tree-sitter fixture: Objective-C, Crystal, and Elm. Objective-C's available tree-sitter grammar reports baseline errors on generated `.m` output; Crystal and Elm have usable grammars but are not included in this parser-coverage pass.

## Test cases added

- `test/inputs/schema/comment-injection.schema` covers object and property descriptions, including both Elm/Haskell nested-comment delimiters, XML doc metacharacters, Unicode line terminators, and descriptions ending in `\`, `"`, and `"""`.
- `test/inputs/schema/comment-injection-enum.schema` covers enum descriptions via an enum-valued property.
- `test/inputs/schema/comment-injection-nested-comment.schema` specifically covers unmatched nested-comment openers (`{-` and `/*`) in object and property descriptions.
- `test/inputs/schema/comment-injection-enum-nested-comment.schema` is the enum-description variant of the nested-comment payload; the tree-sitter fixture substitutes it for the enum-only targets so each sample run does distinct work.

The existing `JSONSchemaFixture` instances pick these samples up for schema-based language tests. Additional narrow `comment-injection-*` fixtures cover affected outputs that did not already have full schema fixtures: Objective-C uses all four samples; TypeScript-Zod and TypeScript-Effect-Schema use the two enum-description samples. The `comment-injection-objective-c` fixture is registered but not run in CI: like the full `objective-c` fixture, the generated `.m` compiles cleanly with clang but the compiled `./test` binary segfaults at runtime (SIGSEGV) on the sample JSON — a pre-existing Objective-C harness issue unrelated to comment injection. It can be run locally on macOS.

A parser-only fixture, `comment-injection-treesitter`, generates all configured targets and parses them with tree-sitter WASM grammars. It currently covers TypeScript, TypeScript-Zod, TypeScript-Effect-Schema, Swift, C#, Java, Dart, C (`cjson`), C++, PHP, Kotlin, Go, Pike, Rust, Ruby, Python, Elixir, Scala 3, and Haskell. It is intentionally one fixture/test that loops over all configured languages and reports all parse failures together. The Swift, Dart, Kotlin, Pike, and Elixir grammars are vendored under `test/tree-sitter-wasms` to avoid npm peer/native dependency issues in CI. Loaded grammars are cached per WASM path across targets and samples.

Two grammar quirks require per-target workarounds in the fixture:

- tree-sitter-dart wrongly parses a block-comment opener inside a line comment (`// /*`) as an ERROR, whereas real Dart runs line comments to the end of the line; the Dart target neutralizes `/*` inside line comments before parsing.
- tree-sitter-c parses preprocessor conditionals structurally and cannot match the `extern "C" {` brace across the two `#ifdef __cplusplus` blocks that `cjson` output uses as a guard, reporting a spurious `MISSING #endif` even for benign output; the cjson target strips those two guard blocks (which only wrap the file) before parsing, so a real injection that leaves a MISSING node is still caught.

The fixture also scans the raw generated bytes for injection classes the grammars can't detect (their lexers are more lenient than the real compilers): no output may contain a surviving U+0085/U+2028/U+2029 line terminator, and per-target `forbiddenSubstrings` catch markup that parses as comment text but is dangerous downstream (C# rejects the raw `</summary> & <br>` payload, verifying the XML entity escaping).

These are regression tests and should pass with the shared comment escaping/sanitization in place.
