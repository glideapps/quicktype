# The packages

-   `quicktype-core`: This is the engine of quicktype. It takes JSON, JSON Schema, and GraphQL input and produces output in a variety of programming languages. We're trying to keep this lean in terms of download size so that it can be embedded, such as in [quicktype-playground](https://github.com/quicktype/quicktype-playground).

-   `quicktype-typescript-input`: This is a bit of code that allows TypeScript code to be fed as input to `quicktype-core`, by transforming it to JSON Schema with [typescript-json-schema](https://github.com/YousefED/typescript-json-schema). It depends on `quicktype-core`.

-   `quicktype-graphql-input`: This is the GraphQL input module. It's split off into a separate package because it's not used in the web UI and `quicktype-playgrounds`, and it uses the moderately sized `graphql` dependency.

-   `quicktype`: This is the command line interface for quicktype. It's a monolithic package that doesn't depend on the other packages, but contains all their code directly. This is mainly for ease of development. Packages that want to use quicktype's CLI interface, such as [json-to-azure-node-schema](https://github.com/json-helpers/json-to-azure-node-schema) will have to use this package.

# Module resolution

`quicktype-typescript-input` and `quicktype-graphql-input` have to work both as their own packages, depending on the `quicktype-core` package, as well as part of `quicktype`, referring to the files in the local `src/quicktype-core` directory.

In addition, since those two input packages depend on `quicktype-core`, we would have to first build `quicktype-core`, publish it, and then build the input packages, depending on the just published `quicktype-core`. This is bad for development, since we couldn't do modifications to all packages without publishing, if we want to test independent of the `quicktype` package. The same goes for CI. Therefore, the two have to build as packages depending on the local `build/quicktype-core` package, but have to be published depending on the proper `quicktype-core` NPM package. We solve this the following way:

-   All packages, including `quicktype-typescript-input` and `quicktype-graphql-input`, import files with local paths, such as `"../quicktype-core"`. This seems the only way to make VSCode's TypeScript integration, as well as `ts-node` happy. Unfortunately, since local paths can's use `tsc`'s path mapping, we have to rewrite those paths _before_ compiling, which is done in `build/quicktype-*-input/build.ts`: it copies all the sources, rewrites them, compiles, and then deletes the copied sources again.

-   Depending on whether we build the input packages, or publish them, their `package.json`s will have to refer to either the local `quicktype-core` package, or the NPM one. This is also done by the build script, which replaces the dependency with the right one for the job.

## Issues

Module resolution in Node is such that if a package is not found in the local `node_modules` directory, it goes up the directory hierarchy and tries every `node_modules` directory it finds. We have a `node_modules` in the root directory of our repo, so a subpackage build will fall back to that if it can't find a package locally. The main consequence of that seems to be that the build won't catch missing dependencies in those packages if they're present in the root package. Moving the root `package.json` to `build/quicktype` screws with lots of tooling.

# Building

The root `quicktype` package does everything from its `package.json`.

The other packages each have a `build.js` in their `build/PACKAGE` directory. It is required to build the root package before building the others, because it will install the `semver` package which the build script for the other packages depend on. It's also required to build `quicktype-core` before building the ones that depend on it. This is how to build everything:

```shell
npm install
( cd build/quicktype-core ; node build.js )
( cd build/quicktype-typescript-input ; node build.js )
( cd build/quicktype-graphql-input ; node build.js )
```
