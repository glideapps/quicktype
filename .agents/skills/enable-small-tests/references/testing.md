# Testing details

Read the current `AGENTS.md`, `test/languages.ts`, `test/fixtures.ts`, and `.github/workflows/test-pr.yaml`; toolchains and registered fixtures can change. These notes cover traps encountered during this task, not a replacement test harness.

## Make the regression exercise the bug

Keyword spelling alone may not trigger a runtime collision. Use values that cause the renderer to emit the relevant helper or validation:

- `DateTime`: an object with a timestamp, forcing date parsing and serialization.
- `EnumValues`: repeated enum strings sufficient for enum inference, forcing the helper.
- `RegExp`: a UUID value, forcing pattern validation where supported.
- `FormatException`: an object with that name plus data elsewhere that emits validation throwing the exception.
- `hashCode`, `runtimeType`, `toString`, `noSuchMethod`: nested keyword objects using the existing `keywords.json` pattern, exercising both property and type names.

Confirm the expected code is generated and that the unfixed program fails. Keep JSON keys unchanged when fixing target-language identifier collisions.

The shared cases exposed more than Dart bugs: Ruby's `DateTime` collided with a standard class, Flow's `RegExp` type shadowed a constructor, C# records named `ToString` collided with a synthesized method, and Effect rejected a `toString` data field. These are reasons to share inputs, not a list of new fixes to submit again. See [runtime names PR #3437](https://github.com/glideapps/quicktype/pull/3437) and [member names PR #3439](https://github.com/glideapps/quicktype/pull/3439).

Scope forbidden names to the affected namespace and option. C# record-only restrictions should not rename ordinary classes. Do not broadly reserve names to avoid investigating a collision.

For runtime-library fixes, inspect the installed library and verify decode **and** encode, constructor behavior, and invalid-input rejection. Effect's `just-schema` option does not remove its generated classes; changing to a different schema API or disabling validation is not equivalent coverage. A local generated-class fix must not mutate a library's global prototype.

## Runtime behavior versus schema text differences

`diffViaSchema` compares generated source from direct JSON inference with source generated via inferred JSON Schema. Different inferred names, ordering, or graph structure can make this diff fail while both programs are correct.

- `skipDiffViaSchema` skips this textual comparison; it is not `skipJSON`.
- `roundtripViaSchema` additionally compiles and runs the schema-generated program against the original JSON. It can preserve behavioral coverage where text identity is inappropriate.
- Trace both paths and use the existing runner support. Keep direct JSON coverage and schema round-trip coverage. Do not add a parallel fixture just for this path.
- Do not globally disable text comparisons or strip meaningful differences to hide a failure. Retain comparisons where they express an intended invariant.

An acceptable test-only change can replace an invalid text-identity requirement with behavioral coverage while preserving public naming. A renderer name change solely to satisfy the text diff is not a production bug fix.

## Discovery and expected failures

Standard JSON inputs are in `priority/` and `samples/`; `misc/` is omitted under `QUICKTEST` and by `skipMiscJSON`. General regressions should not be hidden in `misc/` or a language-only folder.

Inspect `allFixtures`, `getSamples([])`, and `shouldSkipTest()` under the normal CI settings. A language configuration that is not registered does not represent an active test. Special variants may deliberately restrict inputs; verify coverage in every primary language fixture and relevant backend, not merely every configuration object. Check actual execution output, including option variants, rather than inferring coverage from filenames.

For a shared `.schema`, use its same-basename `.json` and numbered `.N.json` samples. Negative cases use:

- `.N.fail.json` for unconditional expected rejection.
- `.N.fail.<feature>.json` for rejection by languages declaring that feature.

A negative case must make the generated program exit nonzero. A changed round-trip result is not rejection. Check that the language declares the feature and the sample is actually selected before claiming coverage. Do not add a feature declaration until its associated existing cases pass.

When testing optional values, separate missing properties, explicit `null`, and valid values. When testing string lengths, distinguish bytes, UTF-16 code units, Unicode code points, and grapheme clusters according to the required semantics. Exercise boundary values on both sides. For escaping, cover actual control characters, backslashes, and enum inference when relevant; rendered source looking plausible is insufficient.

For renderer options, prefer existing `quickTestRendererOptions` entries, including pinned `[filename, options]` cases. Verify how explicit file arguments and default discovery select these entries: one focused invocation does not prove the default option matrix runs them.

## Commands and local isolation

Use `.nvmrc`, `npm ci`, and the repository scripts. Build before testing generated output:

```bash
npm run build
CPUs=2 QUICKTEST=true FIXTURE=dart npm run test:fixtures -- test/inputs/json/priority/keywords.json
CPUs=2 QUICKTEST=true FIXTURE=swift,schema-swift npm run test:fixtures
CPUs=2 QUICKTEST=true FIXTURE=typescript,schema-typescript,typescript-zod,schema-typescript-zod,typescript-effect-schema,schema-typescript-effect-schema npm run test:fixtures
npm run lint
```

Run these sequentially within a worktree. Select the relevant groups rather than launching the entire toolchain matrix for every candidate. Run unit tests when required or affected; fixture coverage remains primary.

Use the repository's `tsx` runner for scratch TypeScript probes. With the TypeScript 7 package used during this task, `ts-node` failed because the package did not expose the compiler API it expected. Check current dependencies instead of adding packages or changing versions to revive an obsolete scratch runner.

Keep temporary baseline patches isolated and restore them before committing. A reverted source edit still requires a rebuild before another generated-code test; stale build output can produce a false pass. Inspect driver lockfiles and setup artifacts for unintended tracked changes.

Nested worktrees can expose multiple Biome configurations to a root scan. Run checks from the intended checkout and inspect only the relevant diff; do not rewrite shared JSON formatting or unrelated files to clear a workspace-layout issue.

## Toolchain failures that are not renderer fixes

Use CI's configured versions as the reference. A pass with a newer local SDK does not prove compatibility with the minimum supported version. Prefer isolated local installs or containers and the existing fixture driver; disclose deviations from the standard test command.

Examples encountered:

- Scala generated `NULLClass` and `NullClass`, which collided on a case-insensitive macOS filesystem. A case-sensitive scratch filesystem allowed the unchanged generated code to run. Do not change intended naming to accommodate the local test disk.
- A newer local JDK required Maven source/target compatibility flags; CI's JDK did not. Treat this as a local invocation issue unless repository support requires a change.
- A host with only a newer .NET runtime needed a local roll-forward setting for the fixture's target. That is not a reason to change generated code or the target framework.
- Python timestamp tests needed `python-dateutil`. Running the driver and `py_compile` without `mypy` is partial validation, not a full Python fixture pass.
- A cJSON helper must actually execute the compiled binary with the sample argument. Shell redirection without running it is not a round-trip test.

For unavailable host languages, an isolated container can compile and run the existing driver. Compare parsed output with the input using the fixture's semantics and record compiler/runtime versions. Do not add bespoke permanent fixtures solely because a local toolchain is missing.

CI setup failures must be distinguished from failures on the changed sample. Consult `AGENTS.md` for the current flake policy. A repeated dependency error can remain an infrastructure blocker; a compiler or runtime error in generated `keywords` code needs investigation even if another job flakes.
