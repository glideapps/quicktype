These are the type definitions of the compiled PureScript modules used by the `quicktype` CLI and other clients.

These are copied into `dist/` on `npm run build`, so if you edit them, be sure to build so that TypeScript can find them.

If any of these interfaces introduce a breaking change, increment `quicktype`'s major version number in `package.json`.