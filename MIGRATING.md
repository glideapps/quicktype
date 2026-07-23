# Migrating to quicktype 24

quicktype 24 raises the minimum supported Node.js version to Node 20. The
project itself is built, tested, and published with Node 24, while CI also
builds and tests the supported Node 20 floor.

The CLI and published libraries now use the native `fetch` implementation
provided by Node.js and modern browsers. Applications running quicktype on a
supported Node.js version do not need to install or configure a fetch
polyfill.

There are no intentional changes to generated code or the public quicktype
API in this release. TypeScript compiler versions are also unchanged.

For contributors, `npm run test:unit` runs the Vitest regression suite and
`npm run test:fixtures` runs the cross-language fixture harness. `npm test`
runs both suites.
