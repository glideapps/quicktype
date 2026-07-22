# Generated-output diffs in CI

## Goals

For every pull request, compare quicktype's generated source at the exact PR base commit with the generated source at GitHub's tested PR merge commit across all registered JSON, JSON Schema, and GraphQL input/target fixture combinations.

Generated-output differences are informational: they must not fail CI. When differences exist, CI publishes a readable report and posts or updates one PR comment containing:

- the number of files that differ;
- the modified, new, and deleted file counts;
- the total changed lines, with insertion and deletion counts; and
- a link to the report.

When there are no differences, no report is published and the output-diff comment confirms that generated outputs are unchanged.

## Deterministic snapshots

The fixture harness has a dedicated output-snapshot mode. It:

- runs the full registered generation fixture set without `QUICKTEST`;
- includes renderer-option variants;
- skips compilation and round-trip execution;
- records multi-file renderer output as well as each target's primary output; and
- writes every case under a stable, collision-resistant path derived from the fixture, input path, and renderer options.

A snapshot contains generated files only. Fixture drivers, copied inputs, tool output, timestamps, and absolute checkout paths are not included.

Both revisions run with the same Node version, timezone, locale, and repository-relative inputs. CI compares the exact `pull_request.base.sha` with the exact tested merge at `github.sha`, not the contributor branch tip in isolation. This matches GitHub's PR diff semantics and prevents changes added to the base branch after the PR forked from appearing as deletions.

## Base snapshot cache

Base snapshots are cached by exact base commit SHA from the start.

The output-diff workflow also runs on pushes to `master`. That job generates the new commit's snapshot and saves it in the default branch's GitHub Actions cache, where pull-request workflows can restore it. The key includes the operating system and exact commit SHA:

```text
quicktype-output-snapshot-v1-<os>-<base-sha>
```

Pull-request jobs restore only the exact key; there are no prefix restore keys. On a cache miss, the PR job generates the base snapshot and saves a PR-scoped cache, which at least benefits reruns of that PR. The push job is what makes the snapshot reusable by unrelated PRs, in accordance with GitHub Actions cache scoping.

The comparison snapshot is always generated from GitHub's current tested PR merge commit. The contributor branch's exact head SHA is still recorded for identity, stale-run protection, and immutable report URLs.

## Comparison data

A repository-owned TypeScript tool compares the two snapshot trees with rename detection disabled. A moved path is therefore represented as one deleted file and one new file.

It emits machine-readable JSON plus a unified patch. Its summary contains:

- total differing files;
- modified files;
- new files;
- deleted files;
- inserted lines;
- deleted lines; and
- total changed lines (`insertions + deletions`).

A difference is a successful result. Snapshot-generation errors, malformed comparison data, and publication errors remain real CI failures.

## Report

The report is static, self-contained HTML with:

- summary cards and base/merge/head commit metadata;
- a prominent link back to the pull request;
- filtering by target, file status, and text search;
- generated files grouped by input test case, with each target clearly labeled;
- collapsible, GitHub-style unified diffs with old/new line numbers; and
- per-test and per-file insertion/deletion totals.

Generated source and paths are always HTML-escaped. The page has a restrictive content-security policy and makes no third-party network requests.

The unified patch is hosted next to the HTML report. Intermediate snapshots and comparison data use GitHub Actions artifacts/caches, not hostr.

## Immutable hostr URLs

Every report is immutable and is published under the path below. The publisher checks for an existing object and never overwrites it:

```text
quicktype/output-diffs/pr-<number>/<pr-sha>/<head-sha>/index.html
```

Here `pr-sha` is the pull-request workflow's tested merge SHA (`github.sha`) and `head-sha` is the contributor branch's exact head commit SHA. Including both distinguishes updates to the PR branch as well as a regenerated test merge after the base branch changes.

The neighboring raw patch is:

```text
quicktype/output-diffs/pr-<number>/<pr-sha>/<head-sha>/output.diff
```

## Security and PR comments

The workflow that executes PR code is unprivileged and never receives the hostr credential or a write-capable GitHub token. It uploads comparison data as a GitHub Actions artifact.

A separate `workflow_run` workflow runs from the default branch. It:

1. downloads the completed comparison artifact;
2. validates the PR number and SHA fields;
3. renders the final HTML using trusted code from the default branch;
4. publishes the HTML and patch using the `HOSTR_TOKEN` repository secret; and
5. creates or updates one marker-tagged PR comment with either the summary and immutable link or a clean-comparison confirmation.

Before changing a comment, it verifies that the artifact's head SHA is still the PR's current head. A stale completed run may retain its immutable report, but it cannot replace the current PR comment.

For a current clean run, the publisher updates the marker-tagged comment to confirm that generated outputs are unchanged and publishes no report.

## Rollout and verification

The implementation is verified with focused tests for:

- stable snapshot paths and renderer-option collision resistance;
- multi-file and overwritten output capture;
- added, deleted, and modified files;
- insertion/deletion/total-line statistics;
- clean comparisons producing no HTML;
- HTML escaping of generated paths and source; and
- the PR backlink and report summary.

The initial infrastructure PR cannot compare against a base that predates snapshot mode. It records an explicit unsupported/clean artifact instead of producing a misleading all-new report. Once merged, the push-to-`master` job creates the first shared base cache, and subsequent PRs exercise the complete flow.
