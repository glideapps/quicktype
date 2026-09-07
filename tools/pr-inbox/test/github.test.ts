import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHub } from "../server/github";
import { AutoMergeCleanStatus, type PRMeta } from "../model";
const pr: PRMeta = {
    number: 1,
    nodeId: "PR_1",
    title: "Test",
    description: "",
    author: "tester",
    createdAt: "",
    updatedAt: "",
    url: "",
    head: "a".repeat(40),
    base: "b".repeat(40),
    draft: false,
    autoMerge: false,
    merged: false,
    mergeable: "MERGEABLE",
    mergeState: "CLEAN",
    ci: "pass",
    additions: 1,
    deletions: 0,
    fileCount: 1,
};
function json(
    body: unknown,
    status = 200,
    headers: Record<string, string> = {},
): Response {
    return new Response(JSON.stringify(body), { status, headers });
}
test("direct merge sends the reviewed SHA and configured method", async (t) => {
    let sent: Record<string, unknown> | undefined;
    t.mock.method(
        globalThis,
        "fetch",
        async (_url: string, options: RequestInit) => {
            sent = JSON.parse(String(options.body));
            return json({ merged: true });
        },
    );
    assert.equal(
        await new GitHub("test/repo", "test-token").merge(pr, "squash"),
        "Merged",
    );
    assert.deepEqual(sent, { sha: pr.head, merge_method: "squash" });
});
test("auto-merge carries an expected head and is not a direct merge", async (t) => {
    let body: { query: string; variables: Record<string, string> } | undefined;
    t.mock.method(
        globalThis,
        "fetch",
        async (url: string, options: RequestInit) => {
            assert.equal(url, "https://api.github.com/graphql");
            body = JSON.parse(String(options.body));
            return json({
                data: {
                    enablePullRequestAutoMerge: {
                        pullRequest: { id: pr.nodeId },
                    },
                },
            });
        },
    );
    for (const blocked of [
        { ...pr, ci: "pending" as const },
        { ...pr, mergeable: "CONFLICTING" as const },
        { ...pr, mergeState: "DIRTY" },
        { ...pr, mergeable: "UNKNOWN" as const },
    ]) {
        assert.equal(
            await new GitHub("test/repo", "test-token").merge(
                blocked,
                "rebase",
            ),
            "Auto-merge enabled",
        );
    }
    assert.match(body?.query ?? "", /enablePullRequestAutoMerge/);
    assert.equal(body?.variables.head, pr.head);
    assert.equal(body?.variables.method, "REBASE");
});
test("clean-status auto-merge rejection is classified", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
        json({
            data: { enablePullRequestAutoMerge: null },
            errors: [
                { message: "Pull request Pull request is in clean status" },
            ],
        }),
    );
    await assert.rejects(
        new GitHub("test/repo", "test-token").merge(
            { ...pr, ci: "pending" },
            "squash",
        ),
        AutoMergeCleanStatus,
    );
});
test("merge queue response enqueues with a head guard", async (t) => {
    const requests: { query?: string; variables?: { head: string } }[] = [];
    t.mock.method(
        globalThis,
        "fetch",
        async (_url: string, options: RequestInit) => {
            requests.push(JSON.parse(String(options.body)));
            return requests.length === 1
                ? json({ message: "This PR must use the merge queue" }, 405)
                : json({ data: { enqueuePullRequest: {} } });
        },
    );
    assert.equal(
        await new GitHub("test/repo", "test-token").merge(pr, "merge"),
        "Added to merge queue",
    );
    assert.match(requests[1].query ?? "", /enqueuePullRequest/);
    assert.equal(requests[1].variables?.head, pr.head);
});
test("failed writes are never automatically retried", async (t) => {
    let writes = 0;
    t.mock.method(globalThis, "fetch", async () => {
        writes++;
        throw new Error("connection dropped");
    });
    await assert.rejects(
        new GitHub("test/repo", "test-token").reply(1, undefined, "Hello"),
    );
    assert.equal(writes, 1);
});
test("ETag revalidation retains pagination when a 304 has no Link header", async (t) => {
    let calls = 0;
    t.mock.method(
        globalThis,
        "fetch",
        async (_url: string, options: RequestInit) => {
            calls++;
            if (calls === 1)
                return json(
                    [
                        {
                            filename: "test.ts",
                            additions: 1,
                            deletions: 0,
                            patch: "@@ -0,0 +1 @@\n+x",
                            blob_url: "https://github.com/test/repo",
                        },
                    ],
                    200,
                    {
                        etag: '"v1"',
                        link: '<https://api.github.com/repos/test/repo/pulls/1/files?page=2>; rel="next"',
                    },
                );
            assert.equal(
                (options.headers as Record<string, string>)["If-None-Match"],
                '"v1"',
            );
            return new Response(null, { status: 304 });
        },
    );
    const github = new GitHub("test/repo", "test-token");
    const first = await github.files(1);
    const second = await github.files(1);
    assert.deepEqual(second, first);
    assert.equal(second.next, "/repos/test/repo/pulls/1/files?page=2");
});
