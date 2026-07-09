# Repository conventions

## Releasing / version bumps

Bump the version in the **root `package.json` only**. Do **not** bump the
`version` fields in the workspace packages (`packages/quicktype-core`,
`packages/quicktype-graphql-input`, `packages/quicktype-typescript-input`,
`packages/quicktype-vscode`) — those are intentionally left at their older,
independent numbers.

At publish time `script/publish.sh` runs `npm version $VERSION --workspaces
--force` to sync the workspaces up to the root version. `npm version` errors
with **"Version not changed"** (even with `--force`) if a workspace already
equals the target, so pre-bumping the workspaces in lockstep with root breaks
the release publish. Leave the workspaces stale and let the publish script
sync them.
