# Repository conventions

## Environment

- This is a TypeScript/npm monorepo using npm workspaces.
- Prefer the Node version from `.nvmrc` (`nvm use`; currently Node 24.6.0). The root CLI package requires Node >= 20.19.0; the library workspaces require Node >= 20.0.0.
- Install dependencies with `npm ci`.

## Build and run

Build everything with:

```bash
npm run build
```

This runs `npm run clean`, builds all workspaces that have a `build` script, and then runs the root `tsc`.

After building, the CLI entry point is `dist/index.js`:

```bash
node dist/index.js --version
node dist/index.js --help
```

For live rebuild/re-run while developing renderer output, use:

```bash
npm start -- "<quicktype args>"
```

## Testing

### Test strategy

quicktype's primary testing method is end-to-end fixture tests driven by JSON and JSON Schema files. For each sample input, a fixture generates code for a language, runs a driver program in `test/fixtures/<language>/` that deserializes the sample and serializes it back, and compares the round-tripped JSON to the input.

Any change that affects generated output **must** be covered by a JSON or JSON Schema fixture test, either by enabling existing inputs for the language or by adding new ones. Unit tests in `test/unit/` complement fixtures for behavior that fixtures cannot express, such as asserting that code is not generated, API-level behavior, or fast local iteration. Do not add a unit test when a fixture test already covers the behavior.

### Fixture layout and configuration

- JSON inputs live in `test/inputs/json/`. `priority/` and `samples/` form the default input set; `misc/` is omitted under `QUICKTEST` and for languages with `skipMiscJSON`. Per-language `skipJSON` and `includeJSON` settings can further restrict inputs.
- JSON Schema inputs live in `test/inputs/schema/`. A `*.schema` can have a same-basename `.json` sample and numbered `.N.json` samples. Numbered `.N.fail.<feature>.json` files are expected failures for languages that declare that feature; `.N.fail.json` files apply regardless of features. An expected-failure sample must make the generated program exit nonzero.
- New schema fixture tests should have at least one positive and one negative test case unless there is a compelling reason not to.
- Per-language configuration—input filters, renderer options, and `features`—lives in `test/languages.ts`.
- Fixtures and their filter names are registered in `test/fixtures.ts`; driver programs live in `test/fixtures/<language>/`.

### Test commands

Run the standalone Vitest unit and regression tests with:

```bash
npm run test:unit
npm run test:unit:watch
```

Run fixture tests with:

```bash
npm run test:fixtures
```

Use fixture filters for focused local testing. Fixture names are registered in `test/fixtures.ts`; comma-separated groups are supported:

```bash
QUICKTEST=true FIXTURE=javascript npm run test:fixtures
QUICKTEST=true FIXTURE=typescript npm run test:fixtures -- test/inputs/json/samples/pokedex.json
FIXTURE=php npm run test:fixtures
FIXTURE=schema-php npm run test:fixtures
CPUs=2 QUICKTEST=true FIXTURE=javascript npm run test:fixtures
```

`QUICKTEST=true` skips the large miscellaneous JSON input set. Arguments after `--` select sample files or directories.

`npm test` runs the Vitest suite followed by all fixture tests. The full fixture suite requires external language toolchains such as .NET, Java/Maven, Go, Rust, Python/mypy, PHP, Ruby, Kotlin, Scala, and Elixir; it will fail when a required toolchain is unavailable. GitHub Actions uses focused fixture groups configured in `.github/workflows/test-pr.yaml`, for example `QUICKTEST=true FIXTURE=${{ matrix.fixture }} npm run test:fixtures`.

Formatting and linting use Biome:

```bash
npm run lint
npm run lint:fix
```

## Known CI flakiness

Three fixture-CI failure modes are infrastructure flakes rather than test or PR bugs:

- **scala3-upickle**: the Bloop compiler server sometimes times out after 30 seconds at startup, and `maven-nightlies` artifact downloads sometimes fail.
- **elm**: fixture setup (`rm -rf elm-stuff && elm make Warmup.elm`) can race the compiler and deadlock on `elm-stuff/*.dat` file locks.
- **cjson**: `cJSON.c` is downloaded from raw.githubusercontent.com at test time and can encounter transient SSL or connection failures.

The fixture matrix uses `fail-fast: true`, so one flaky job cancels sibling language jobs. The `test-complete` check only mirrors the matrix and is not an independent failure.

For now, retry these failed jobs with `gh run rerun <run-id> --failed`. Treat a failure in one of these areas as real only if it reproduces across retries or the PR touches that area.

## Releasing and version bumps

Do not bump versions in any `package.json` before a release. Package manifest versions are intentionally allowed to be stale in the repository.

To publish, create a GitHub Release targeting the commit to release. Stable tags have the form `vMAJOR.MINOR.PATCH` (for example, `v24.0.0`); prerelease tags have the form `vMAJOR.MINOR.PATCH-preN` (for example, `v25.0.0-pre1`). Publishing the release triggers the npm workflow, which publishes stable versions under the `latest` dist-tag and prereleases under `pre`. The VS Code Marketplace workflow runs only for stable tags.

Both workflows derive the version exclusively from the release tag and stamp all manifests in the Actions checkout before publishing; those changes are not committed. The release version must be greater than every earlier non-draft GitHub Release with a supported tag. Publication is refused if npm or the VS Code Marketplace already has a newer supported version; an exact version match is skipped, so rerunning a partially completed release is safe.

Test the release-version helper with:

```bash
npm run test:release
```
