---
name: enable-small-tests
description: Find and ship small quicktype fixes that enable disabled tests, using shared inputs and existing language fixtures. Use for batches of test-enabling PRs or their review, conflict, and CI follow-up; prioritize Dart, Swift, and TypeScript unless directed otherwise.
---

# Small test-enabling PRs

Turn disabled coverage into small, independently reviewable fixes. Read the repository's `AGENTS.md` and current test configuration first. This skill records the user's preferences for this task; later user instructions take precedence.

## Constraints

- **At most 15 production lines added plus removed per fix**, including formatting changes. Use normal repository formatting. Do not compress code, hide implementation in test helpers, or split one larger fix into artificial pieces to meet the limit.
- Keep each PR small and coherent. Prefer one independent fix per PR. Closely related collisions exposed by the same shared test can share a small PR; report each fix's line count. A count limit is not permission to accumulate a large PR.
- **Combine all test-only changes into one PR**, across languages. Keep regression cases with their production fix. Put shared harness improvements in the test-only PR instead of copying them into every branch.
- Focus on Dart, Swift, and TypeScript by default. Use the requested PR count, including the combined test-only PR; the original batch requested 20, which is not a standing quota. Do not pad a batch with cosmetic changes or duplicated fixes. Report a shortfall if suitable candidates run out.
- **Use shared test cases, not new per-bug fixtures.** General inputs, especially keyword cases, must run across languages. A newly discovered bug does not by itself justify a new driver, fixture registration, schema, or language-only input list.
- Preserve intended generated naming. Reject “stabilize names” changes whose only purpose is making JSON-versus-schema output text identical. Renaming is justified when the original name actually prevents compilation or runtime behavior, with evidence.
- Modify only relevant code; respect existing abstraction boundaries. No unrelated cleanup, version bumps, or tombstone comments/docs explaining removed behavior.
- Write descriptions, comments, commits, and summaries tersely. Explain **what and why**, include useful links and validation, and omit praise and conversational history.

## Find candidates

Search `test/languages.ts`, `test/fixtures.ts`, and the existing inputs. Useful starting points:

```bash
rg -n 'skipJSON|includeJSON|skipSchema|skipDiffViaSchema|features|quickTestRendererOptions' test/languages.ts
rg -n 'getSamples|shouldSkipTest|additionalSchemaFiles|roundtripViaSchema' test/fixtures.ts
```

Trace each exclusion through the actual registered fixture and runner. Distinguish:

- Disabled compilation or JSON round-trip coverage.
- Missing validation or an unsupported language feature.
- A textual `diffViaSchema` failure despite correct behavior.
- A toolchain/setup failure or obsolete exclusion.

Inspect the failing generated program before editing the renderer. Favor narrow escaping, runtime-name collisions, optional/null semantics, validation boundaries, and renderer-option omissions. Defer features requiring architectural changes or more than 15 production lines.

For a batch, keep an ignored ledger with candidate, language, existing input, baseline failure, proposed change, production line count, branch/PR, tests, CI, and review status. Mark rejected candidates and their reason to avoid rediscovery.

## Prove the fix with existing tests

1. For a production fix, reproduce the actual failure on the base revision using the intended test case. For an obsolete exclusion, prove the existing implementation already passes and make a test-only change. Temporarily enabling a skipped input is fine. Confirm the runner selected and executed it; a successful command that ran zero relevant tests proves nothing.
2. Make the smallest correct production change, then remove the specific obsolete exclusion or extend an existing shared input. Do not weaken assertions, feature declarations, expected output, or validation to obtain a pass.
3. Verify the same case passes with the fix, including compilation and round-trip or expected rejection. Run relevant renderer options and sibling implementations, then the affected fixture group and required build/lint checks.
4. Check the **combined** shared input when several PRs extend it. Independently passing branches can still interact after merging.

Every generated-output change needs fixture coverage. Use a unit test only for behavior the fixture cannot express, such as absence of emitted code or an API contract; do not duplicate fixture coverage with unit tests.

See [testing details](references/testing.md) when selecting samples, diagnosing naming differences, checking shared discovery, or dealing with local toolchains.

## Share cases across languages

A **fixture** is the registered driver/runner configuration. A **case** is input data consumed by it. Adding a regression usually means adding data to an existing case, not creating another fixture.

Use this preference order:

1. Enable an existing input for the affected language.
2. Extend an appropriate shared input. Add runtime/member keywords to `test/inputs/json/priority/keywords.json`; preserve its established grouping and formatting.
3. Add numbered positive/negative samples to an existing schema when its semantics fit.
4. Only if existing inputs cannot express the bug, add a small shared JSON/schema input discovered by ordinary language fixtures. Explain the missing coverage in the PR. A new schema needs a positive and negative case unless rejection is irrelevant to the bug.

Use existing renderer-option cases and driver capabilities for option-specific behavior. Create a fixture only when the existing execution model cannot test the behavior, and explain why. File count or ease of isolation is not a reason.

Do not restrict new general cases to the first affected language. If shared coverage exposes another language bug, reproduce and fix it within the same small-change constraints. **Do not add keyword exclusions to make CI green.** If a required fix exceeds the scope, report the concrete blocker instead of silently reducing coverage. Capability-specific validation should use established feature conventions, without declaring unsupported features merely to collect tests.

Use normal schema discovery. For inputs that genuinely require `additionalSchemaFiles`, use the existing shared hook and its array-spread idiom. Do not reimplement `getSamples()` or repeatedly add `.concat(this.language.additionalSchemaFiles ?? [])` in production-fix PRs.

## Work in parallel without contaminating branches

When delegation is authorized, assign bounded candidates or language groups to agents in separate worktrees. Give each agent the size limit, shared-test rule, branch ownership, and required evidence. Reserve a single owner for shared harness changes and PR updates.

Declare dependencies on the shared test-only PR. Keep each review diff limited to its own change, and arrange the dependency to land first; do not copy the harness patch into every independent PR. Rebase or update dependent branches after it lands, then recheck their diffs and tests.

Fetch the current base before starting or updating PRs. Use the workspace's target branch, normally `origin/master`, and preserve any instruction not to rename the current branch. Avoid carrying unrelated work into a PR. Put scratch scripts, generated programs, and the ledger in ignored storage; do not assume old `.context` helpers exist elsewhere.

**Never run separate fixture-suite invocations concurrently in one worktree:** the runner deletes `test/runs` at startup. Builds also clean outputs. Parallelize across worktrees, and coordinate shared driver setup and commits.

Inspect the final diff against the current PR base, not just the latest commit:

```bash
git diff origin/master...HEAD --stat
git diff origin/master...HEAD --numstat -- packages/
git diff origin/master...HEAD --check
```

Classify production by behavior, not path; helper code outside `packages/` can still be production. Account for each fix's additions and deletions after formatting. Remove obsolete cases/registrations rather than leaving both old and replacement coverage.

## Deliver and maintain the PRs

When the user requests PRs, create and push them within that authorization. Do not stop at proposals or ask again for routine edits, testing, rebases/merges, or authorized pushes. Do not merge PRs unless the user asks. This skill alone does not authorize publishing work.

PR descriptions should state the triggering input, broken behavior, resulting behavior, newly enabled coverage, validation, and production line count. Scale detail to the change. Rewrite the title/body when the final scope changes; omit abandoned approaches. For multiline `gh` bodies, use a file and `--body-file`.

Attend to both review threads and ordinary PR comments. **Reply to addressed comments and resolve their threads when resolved.** An amended commit alone is not a reply. Explain any disagreement briefly with evidence.

Recheck mergeability as the user merges sibling PRs. Resolve conflicts semantically, retaining both branches' shared cases and distinct fixes, then rerun affected checks and push. Check PR state first: if already merged, verify the combined result on master instead of modifying a stale branch.

Inspect CI failures at the job/log level. Follow `AGENTS.md` for known Scala, Elm, and cJSON flakes; retry failed jobs with `gh run rerun <run-id> --failed`. The fail-fast matrix cancels siblings, and `test-complete` mirrors it. If the failure repeats, investigate the actual cause rather than retrying indefinitely or changing production code for an unavailable artifact. Retest real failures; report an external blocker if it cannot be resolved.

Track CI for the **latest pushed head**. A previous green commit is not validation of new edits. Ensure canceled required jobs run after a retry; canceled or pending checks are not passes. Report pending CI as pending and missing toolchains as untested; do not claim “all languages pass” from generation alone or from selected local runs.

Finish with a concise outcome: PR links, meaningful changes, checks, and any remaining failures or conflicts. For a high-level summary, group by behavior rather than recounting the work.
