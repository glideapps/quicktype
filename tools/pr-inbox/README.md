# PR inbox

A local browser inbox for reviewing, commenting on, and merging open pull requests.

Use Node 24 and authenticate GitHub CLI first:

```sh
nvm use
npm ci
gh auth login
npm run prs -- --since "4 days"
```

The browser opens at the printed localhost URL. Press Ctrl+C to stop the server. The GitHub token comes from `gh auth token` and stays in server memory.

```sh
npm run prs -- --since "12h" --repo owner/repo --port 4317 --no-open
npm run prs -- --merge-method rebase
```

`--since` accepts hours, days, or weeks. The default repository is `glideapps/quicktype`; the default merge method is `squash`. Other methods are `merge` and `rebase`.

## Shortcuts

- ↑ / ↓: previous / next PR
- ← / →: previous / next file
- D / S: diff / CI
- C: comment; ⌘Enter or Ctrl+Enter: post
- M: merge or enable auto-merge
- ⌘K, Ctrl+K, or /: find a PR
- ?: all shortcuts; Escape: close dialogs

PRs and details load progressively and cache locally. CI and mergeability refresh every 30 seconds. Returning to a disconnected tab reconnects automatically.

## Development

Run `npm run check:prs`, `npm run test:prs`, and `npx biome check tools/pr-inbox package.json`.
