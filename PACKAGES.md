# The packages

* `quicktype-core`: This is the engine of quicktype. It takes JSON, JSON Schema, and GraphQL input and produces output in a variety of programming languages. We're trying to keep this lean in terms of download size so that it can be embedded, such as in [quicktype-playground](https://github.com/quicktype/quicktype-playground).

* `quicktype-typescript-input`: This is a bit of code that allows TypeScript code to be fed as input to `quicktype-core`, by transforming it to JSON Schema with [typescript-json-schema](https://github.com/YousefED/typescript-json-schema). It depends on `quicktype-core`.

* `quicktype`: This is the command line interface for quicktype. It's a monolithic package that doesn't depend on either `quicktype-core` or `quicktype-typescript-input`, but contains all their code directly. This is mainly for ease of development. Packages that want to use quicktype's CLI interface, such as [json-to-azure-node-schema](https://github.com/json-helpers/json-to-azure-node-schema) will have to use this package.

# Building and module resolution

`quicktype-typescript-input` has to work both as its own package, depending on the `quicktype-core` package, as well as part of `quicktype`, referring to the files in the local `src/quicktype-core` directory.

In addition, since `quicktype-typescript-input` depends on `quicktype-core`, we would have first build `quicktype-core`, publish it, and then build `quicktype-typescript-input`, depending on the just published `quicktype-core`. This is bad for development, since we couldn't do modifications to both packages without publishing, if we want to test independent of the `quicktype` package. The same goes for CI. Therefore, it has to build as a package depending on the local `build/quicktype-core` package, but has to be published depending on the proper `quicktype-core` NPM package. We solve this the following way:

* `quicktype-typescript-input` imports from `"quicktype-core"` as if it were a package dependency. That means its `.js` files won't have to be modified for packaging of `quicktype-typescript-input`, but they will have to be rewritten to refer to `"../quicktype-core"` when building as part of the `quicktype` package. This rewriting happens in `script/build.ts`.

* Its `package.json` will have to refer to either the local `quicktype-core` package, or the NPM one. We do this by having a build script `build/quicktype-typescript-input/build.ts` that replaces the dependency with the right one for the job.
