import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    AutoMergeCleanStatus,
    canMergeDirectly,
    makePR,
    orderActivities,
    parseSince,
    type Activity,
    type FileChange,
    type PRMeta,
} from "../model";
import { Gateway, patchComplete, reconcile } from "../server/gateway";
import type { Page, Provider } from "../server/github";
import { createInboxServer, parseCommand, parseState } from "../server/http";
import { Scheduler } from "../server/scheduler";
import { InboxService } from "../server/service";
import { Storage } from "../server/storage";
import { parsePatch } from "../web/diff";
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
}
const meta = (number = 1): PRMeta => ({
    number,
    nodeId: `PR_${number}`,
    title: `PR ${number}`,
    author: "tester",
    createdAt: "2026-09-05T00:00:00Z",
    updatedAt: "2026-09-05T00:00:00Z",
    url: `https://github.com/test/repo/pull/${number}`,
    head: "a".repeat(40),
    base: "b".repeat(40),
    description: "A PR",
    ci: "pass",
    draft: false,
    autoMerge: false,
    merged: false,
    mergeable: "MERGEABLE",
    mergeState: "CLEAN",
    additions: 1,
    deletions: 0,
    fileCount: 1,
});
const file: FileChange = {
    path: "test.ts",
    patch: "@@ -0,0 +1 @@\n+hello",
    additions: 1,
    deletions: 0,
    url: "https://github.com/test/repo/blob/main/test.ts",
};
const activity: Activity = {
    id: "thread1",
    type: "thread",
    path: "test.ts",
    line: 1,
    resolved: false,
    messages: [
        {
            id: "comment1",
            author: "tester",
            body: "Please fix",
            url: "https://github.com/test/repo/pull/1",
            createdAt: "2026-09-05T00:00:00Z",
            updatedAt: "2026-09-05T00:00:00Z",
        },
    ],
};
function provider(): Provider {
    return {
        list: async () => ({ items: [meta()] }),
        meta: async (number) => meta(number),
        files: async () => ({ items: [file] }),
        comments: async () => ({ items: [] }),
        threads: async () => ({ items: [structuredClone(activity)] }),
        replies: async () => ({ items: [] }),
        checks: async () => ({ items: [] }),
        statuses: async () => ({ items: [] }),
        fullDiff: async () =>
            `diff --git a/test.ts b/test.ts\n--- /dev/null\n+++ b/test.ts\n${file.patch}\n`,
        merge: async (pr) =>
            canMergeDirectly(pr) ? "Merged" : "Auto-merge enabled",
        reply: async () => {},
        resolve: async () => {},
    };
}
async function until(predicate: () => boolean): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > 3000)
            throw new Error("Timed out waiting for condition");
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}
const untilReady = (service: InboxService): Promise<void> =>
    until(() => {
        const pr = service.prs.get(1);
        return (
            pr?.files.status === "ready" &&
            pr.comments.status === "ready" &&
            pr.checks.status === "ready"
        );
    });
async function setup(t: TestContext, github = provider()) {
    const dir = await mkdtemp(join(tmpdir(), "pr-inbox-test-"));
    const storage = new Storage(join(dir, "cache"), join(dir, "state"));
    await storage.initialize();
    const gateway = new Gateway(github, storage);
    const service = new InboxService(
        gateway,
        "test/repo",
        "4 days",
        "2026-09-01T00:00:00Z",
        "squash",
    );
    t.after(async () => {
        await service.close();
        await rm(dir, { recursive: true, force: true });
    });
    return { service, gateway, storage, github };
}
test("duration uses a rolling cutoff and rejects invalid windows", () => {
    const now = Date.parse("2026-09-05T12:00:00Z");
    assert.equal(parseSince("4 days", now), "2026-09-01T12:00:00.000Z");
    assert.equal(parseSince("12h", now), "2026-09-05T00:00:00.000Z");
    assert.equal(parseSince("0.5 weeks", now), "2026-09-02T00:00:00.000Z");
    for (const bad of ["0 days", "-4 days", "tomorrow", "4 months", "NaN"])
        assert.throws(() => parseSince(bad, now));
});
test("scheduler reserves foreground slots, promotes queued work, and deduplicates", async () => {
    const scheduler = new Scheduler();
    scheduler.prioritize([1, 2]);
    const a = deferred<void>(),
        b = deferred<void>();
    const started: string[] = [];
    const background = scheduler.request("slow", 2, async () => {
        started.push("slow");
        await a.promise;
    });
    const queued = scheduler.request("promote", 3, async () => {
        started.push("promote");
        await b.promise;
    });
    assert.equal(
        scheduler.request("promote", 3, async () => {
            throw new Error("Duplicate executed");
        }),
        queued,
    );
    await until(() => started.length === 1);
    assert.deepEqual(started, ["slow"]);
    scheduler.prioritize([3, 1]);
    await until(() => started.length === 2);
    a.resolve();
    b.resolve();
    await Promise.all([background, queued]);
    scheduler.close();
});
test("a read after completion runs again instead of reusing a settled request", async () => {
    const scheduler = new Scheduler();
    let reads = 0;
    assert.equal(await scheduler.request("list", 0, async () => ++reads), 1);
    assert.equal(await scheduler.request("list", 0, async () => ++reads), 2);
    scheduler.close();
});
test("list and description are usable while files are still fetching", async (t) => {
    const github = provider(),
        gate = deferred<Page<FileChange>>();
    github.files = () => gate.promise;
    const { service } = await setup(t, github);
    await service.start();
    await until(() => service.prs.has(1));
    assert.equal(service.prs.get(1)?.description, "A PR");
    assert.equal(service.prs.get(1)?.files.status, "loading");
    assert.equal(service.prs.get(1)?.files.data.length, 0);
    gate.resolve({ items: [file] });
    await until(() => service.prs.get(1)?.files.status === "ready");
});
test("cached content appears before network revalidation and interrupted loads resume", async (t) => {
    const github = provider(),
        gate = deferred<Page<PRMeta>>();
    github.list = () => gate.promise;
    const { storage, service } = await setup(t, github);
    await storage.initialize();
    const cached = makePR(meta());
    cached.files = { status: "loading", data: [file] };
    await storage.save([cached]);
    await service.start();
    assert.equal(service.prs.get(1)?.files.data[0].path, "test.ts");
    assert.equal(service.status.loading, true);
    gate.resolve({ items: [meta()] });
    await until(() => !service.status.loading);
});
test("file pages publish incrementally and missing pages are errors, not empty states", async (t) => {
    const github = provider();
    github.list = async () => ({ items: [{ ...meta(), fileCount: 2 }] });
    github.meta = async () => ({ ...meta(), fileCount: 2 });
    const gate = deferred<Page<FileChange>>();
    github.files = async (_n, page) =>
        page ? gate.promise : { items: [file], next: "page2" };
    const { service } = await setup(t, github);
    await service.start();
    await until(() => service.prs.get(1)?.files.data.length === 1);
    assert.equal(service.prs.get(1)?.files.status, "loading");
    gate.resolve({ items: [] });
    await until(() => service.prs.get(1)?.files.status === "error");
    assert.match(service.prs.get(1)?.files.error ?? "", /1 of 2/);
});
test("reconciliation invalidates revision-bound details without blanking same-head checks", () => {
    const old = makePR(meta());
    old.files = { status: "ready", data: [file] };
    old.checks = {
        status: "ready",
        data: [
            {
                id: "ci",
                name: "CI",
                status: "pass",
                detail: "Passed",
                url: "https://example.com/ci",
            },
        ],
        updatedAt: "2026-09-05T00:00:00Z",
    };
    assert.equal(reconcile(meta(), old).files, old.files);
    const base = reconcile({ ...meta(), base: "c".repeat(40) }, old);
    assert.equal(base.files.status, "idle");
    assert.equal(base.checks.status, "ready");
    const changedCI = reconcile({ ...meta(), ci: "fail" }, old);
    assert.equal(changedCI.checks.status, "idle");
    assert.equal(changedCI.checks.data, old.checks.data);
    assert.equal(changedCI.checks.updatedAt, old.checks.updatedAt);
    const head = reconcile({ ...meta(), head: "d".repeat(40) }, old);
    assert.equal(head.files.data.length, 0);
    assert.equal(head.checks.status, "idle");
    assert.equal(head.checks.data.length, 0);
});
test("polling keeps definitive mergeability until GitHub finishes recomputing", () => {
    const newBase = "c".repeat(40);
    const conflict = makePR({
        ...meta(),
        mergeable: "CONFLICTING",
        mergeState: "DIRTY",
    });
    const unknown = reconcile(
        {
            ...meta(),
            base: newBase,
            mergeable: "UNKNOWN",
            mergeState: "UNKNOWN",
        },
        conflict,
    );
    assert.equal(unknown.mergeable, "CONFLICTING");
    assert.equal(unknown.mergeState, "DIRTY");
    assert.equal(unknown.files.status, "idle");

    const definitiveMergeable = reconcile(
        { ...meta(), mergeState: "UNKNOWN" },
        conflict,
    );
    assert.equal(definitiveMergeable.mergeable, "MERGEABLE");
    assert.equal(definitiveMergeable.mergeState, "UNKNOWN");
    assert.equal(canMergeDirectly(definitiveMergeable), true);

    const clean = reconcile({ ...meta(), base: newBase }, unknown);
    assert.equal(clean.mergeable, "MERGEABLE");
    assert.equal(clean.mergeState, "CLEAN");

    const contradictory = reconcile(
        { ...meta(), mergeable: "MERGEABLE", mergeState: "DIRTY" },
        conflict,
    );
    assert.equal(contradictory.mergeable, "MERGEABLE");
    assert.equal(contradictory.mergeState, "DIRTY");
    assert.equal(canMergeDirectly(contradictory), false);
});
test("comments and nested replies paginate and sort newest activity first", async (t) => {
    const github = provider();
    github.threads = async () => ({
        items: [{ ...structuredClone(activity), nextReply: "more" }],
    });
    github.replies = async () => ({
        items: [
            {
                ...activity.messages[0],
                id: "new",
                body: "Latest",
                updatedAt: "2026-09-05T12:00:00Z",
            },
        ],
    });
    const { service } = await setup(t, github);
    await service.start();
    await until(() => service.prs.get(1)?.comments.status === "ready");
    assert.equal(
        service.prs.get(1)?.comments.data[0].messages[0].body,
        "Latest",
    );
    assert.equal(
        orderActivities([
            { ...activity, id: "older" },
            {
                ...activity,
                id: "newer",
                messages: [
                    {
                        ...activity.messages[0],
                        updatedAt: "2026-09-06T00:00:00Z",
                    },
                ],
            },
        ])[0].id,
        "newer",
    );
});
test("merge rejects changed heads and drafts without writing", async (t) => {
    const github = provider();
    let writes = 0;
    github.merge = async () => {
        writes++;
        return "Merged";
    };
    const { service } = await setup(t, github);
    await service.start();
    await until(() => service.prs.has(1));
    for (const replacement of [
        { ...meta(), head: "c".repeat(40) },
        { ...meta(), draft: true },
    ]) {
        github.meta = async () => replacement;
        await assert.rejects(
            service.command({ action: "merge", number: 1, head: meta().head }),
        );
    }
    assert.equal(writes, 0);
});
test("a conflict discovered at merge time enables auto-merge even with green CI", async (t) => {
    const github = provider();
    const { service } = await setup(t, github);
    await service.start();
    await until(() => !service.status.loading);
    github.meta = async () => ({ ...meta(), mergeable: "CONFLICTING" });
    assert.equal(
        (
            await service.command({
                action: "merge",
                number: 1,
                head: meta().head,
            })
        ).message,
        "Auto-merge enabled",
    );
    assert.equal(service.prs.get(1)?.mergeable, "CONFLICTING");
    assert.equal(service.prs.get(1)?.autoMerge, true);
    github.meta = async () => ({
        ...meta(),
        mergeable: "CONFLICTING",
        autoMerge: true,
    });
    github.merge = async () => {
        throw new Error("Should not write twice");
    };
    assert.equal(
        (
            await service.command({
                action: "merge",
                number: 1,
                head: meta().head,
            })
        ).message,
        "Auto-merge already enabled",
    );
});
test("merge decisions use fresh metadata while an unknown refresh keeps stable display state", async (t) => {
    const github = provider();
    let received: PRMeta | undefined;
    github.meta = async () => ({
        ...meta(),
        mergeable: "UNKNOWN",
        mergeState: "UNKNOWN",
    });
    github.merge = async (pr) => {
        received = pr;
        return "Auto-merge enabled";
    };
    const { service } = await setup(t, github);
    await service.start();
    await until(() => service.prs.has(1));
    assert.equal(
        (
            await service.command({
                action: "merge",
                number: 1,
                head: meta().head,
            })
        ).message,
        "Auto-merge enabled",
    );
    assert.equal(received?.mergeable, "UNKNOWN");
    assert.equal(service.prs.get(1)?.mergeable, "MERGEABLE");
    assert.equal(service.prs.get(1)?.mergeState, "CLEAN");
});
test("every 30 seconds refreshes CI and conflicts across the queue", async (t) => {
    const github = provider();
    let items = [meta(1), meta(2)],
        reads = 0,
        checkReads = 0;
    github.list = async () => {
        reads++;
        return { items };
    };
    github.checks = async () => {
        checkReads++;
        return { items: [] };
    };
    const { service } = await setup(t, github);
    t.mock.timers.enable({ apis: ["setInterval"] });
    await service.start();
    await until(
        () =>
            !service.status.loading &&
            service.prs.get(1)?.checks.status === "ready" &&
            service.prs.get(2)?.checks.status === "ready",
    );
    const initialChecks = checkReads;
    items = [meta(1), { ...meta(2), ci: "fail", mergeable: "CONFLICTING" }];
    t.mock.timers.tick(29999);
    assert.equal(reads, 1);
    t.mock.timers.tick(1);
    await until(
        () =>
            reads === 2 &&
            !service.status.loading &&
            checkReads > initialChecks,
    );
    assert.equal(service.prs.get(2)?.ci, "fail");
    assert.equal(service.prs.get(2)?.mergeable, "CONFLICTING");
});
test("merging refreshes other PRs even when a list request is already in flight", async (t) => {
    const github = provider();
    let items = [meta(1), meta(2)],
        reads = 0;
    const gate = deferred<Page<PRMeta>>();
    github.list = async () => (++reads === 2 ? gate.promise : { items });
    github.merge = async () => {
        items = [{ ...meta(2), mergeable: "CONFLICTING" }];
        return "Merged";
    };
    const { service } = await setup(t, github);
    await service.start();
    await until(() => !service.status.loading);
    const refresh = service.refresh();
    await until(() => reads === 2);
    await service.command({ action: "merge", number: 1, head: meta().head });
    gate.resolve({ items: [meta(1), meta(2)] });
    await refresh;
    await until(() => reads === 3 && !service.status.loading);
    assert.equal(service.prs.has(1), false);
    assert.equal(service.prs.get(2)?.mergeable, "CONFLICTING");
});
test("green merges and pending CI enables auto-merge only after provider success", async (t) => {
    const github = provider();
    let fresh = { ...meta(), ci: "pending" as const } as PRMeta;
    github.meta = async () => fresh;
    const gate = deferred<string>();
    github.merge = () => gate.promise;
    const { service } = await setup(t, github);
    await service.start();
    await until(() => service.prs.has(1));
    const action = service.command({
        action: "merge",
        number: 1,
        head: fresh.head,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(service.prs.get(1)?.autoMerge, false);
    gate.resolve("Auto-merge enabled");
    assert.equal((await action).message, "Auto-merge enabled");
    assert.equal(service.prs.get(1)?.autoMerge, true);
    fresh = meta();
    github.merge = async () => {
        github.list = async () => ({ items: [] });
        return "Merged";
    };
    assert.equal(
        (
            await service.command({
                action: "merge",
                number: 1,
                head: fresh.head,
            })
        ).message,
        "Merged",
    );
    assert.equal(service.prs.has(1), false);
});
test("ambiguous merge response is reconciled before retry", async (t) => {
    const github = provider();
    let merged = false,
        writes = 0;
    github.meta = async () => ({ ...meta(), merged });
    github.merge = async () => {
        writes++;
        merged = true;
        throw new Error("connection lost");
    };
    const { service } = await setup(t, github);
    await service.start();
    await until(() => service.prs.has(1));
    assert.equal(
        (
            await service.command({
                action: "merge",
                number: 1,
                head: meta().head,
            })
        ).message,
        "Merged",
    );
    assert.equal(writes, 1);
});
test("clean-status race directly merges the same reviewed head", async (t) => {
    const github = provider();
    let raced = false,
        writes = 0;
    github.meta = async () => (raced ? meta() : { ...meta(), ci: "pending" });
    github.merge = async (candidate) => {
        writes++;
        if (writes === 1) {
            raced = true;
            throw new AutoMergeCleanStatus();
        }
        assert.equal(candidate.head, meta().head);
        assert.equal(canMergeDirectly(candidate), true);
        return "Merged";
    };
    const { service } = await setup(t, github);
    await service.start();
    await untilReady(service);
    assert.equal(
        (
            await service.command({
                action: "merge",
                number: 1,
                head: meta().head,
            })
        ).message,
        "Merged",
    );
    assert.equal(writes, 2);
});
test("clean-status race blocks a changed head", async (t) => {
    const github = provider();
    let raced = false,
        writes = 0;
    github.meta = async () =>
        raced
            ? { ...meta(), head: "c".repeat(40) }
            : { ...meta(), ci: "pending" };
    github.merge = async () => {
        writes++;
        raced = true;
        throw new AutoMergeCleanStatus();
    };
    const { service } = await setup(t, github);
    await service.start();
    await untilReady(service);
    await assert.rejects(
        service.command({ action: "merge", number: 1, head: meta().head }),
        /New commits arrived/,
    );
    assert.equal(writes, 1);
});
test("clean-status race requires freshly proven merge readiness", async (t) => {
    for (const actual of [
        { ...meta(), mergeable: "CONFLICTING" as const },
        { ...meta(), ci: "pending" as const },
    ]) {
        const github = provider();
        let raced = false,
            writes = 0;
        github.meta = async () =>
            raced ? actual : { ...meta(), ci: "unknown" };
        github.merge = async () => {
            writes++;
            raced = true;
            throw new AutoMergeCleanStatus();
        };
        const { service } = await setup(t, github);
        await service.start();
        await untilReady(service);
        await assert.rejects(
            service.command({ action: "merge", number: 1, head: meta().head }),
            /merge conflicts|CI is not green/,
        );
        assert.equal(writes, 1);
    }
});
test("clean-status recovery reports draft, unknown, and failed refresh", async (t) => {
    for (const [actual, expected] of [
        [{ ...meta(), draft: true }, /draft/],
        [{ ...meta(), mergeable: "UNKNOWN" }, /still calculating/],
        [undefined, /Could not refresh/],
    ] as const) {
        const github = provider();
        let raced = false,
            writes = 0;
        github.meta = async () => {
            if (raced) {
                if (!actual) throw new Error("read failed");
                return actual;
            }
            return { ...meta(), ci: "pending" };
        };
        github.merge = async () => {
            writes++;
            raced = true;
            throw new AutoMergeCleanStatus();
        };
        const { service } = await setup(t, github);
        await service.start();
        await untilReady(service);
        await assert.rejects(
            service.command({ action: "merge", number: 1, head: meta().head }),
            expected,
        );
        assert.equal(writes, 1);
    }
});
test("ambiguous recovery merge is reconciled without another write", async (t) => {
    const github = provider();
    let raced = false,
        merged = false,
        writes = 0;
    github.meta = async () =>
        merged
            ? { ...meta(), merged: true }
            : raced
              ? meta()
              : { ...meta(), ci: "pending" };
    github.merge = async () => {
        writes++;
        if (!raced) {
            raced = true;
            throw new AutoMergeCleanStatus();
        }
        merged = true;
        throw new Error("connection lost");
    };
    const { service } = await setup(t, github);
    await service.start();
    await untilReady(service);
    assert.equal(
        (
            await service.command({
                action: "merge",
                number: 1,
                head: meta().head,
            })
        ).message,
        "Merged",
    );
    assert.equal(writes, 2);
});
test("arbitrary merge failures are not retried", async (t) => {
    const github = provider();
    let writes = 0;
    github.meta = async () => ({ ...meta(), ci: "pending" });
    github.merge = async () => {
        writes++;
        throw new Error("network write failed");
    };
    const { service } = await setup(t, github);
    await service.start();
    await until(() => service.prs.has(1));
    await assert.rejects(
        service.command({ action: "merge", number: 1, head: meta().head }),
        /network write failed/,
    );
    assert.equal(writes, 1);
});
test("reply-and-resolve never repeats a successful reply when resolution fails", async (t) => {
    const github = provider();
    let replies = 0;
    github.reply = async () => {
        replies++;
    };
    github.resolve = async () => {
        throw new Error("forbidden");
    };
    const { service } = await setup(t, github);
    await service.start();
    await until(() => service.prs.get(1)?.comments.status === "ready");
    const result = await service.command({
        action: "reply",
        number: 1,
        activityId: "thread1",
        body: "Fixed",
        resolve: true,
    });
    assert.equal(replies, 1);
    assert.match(result.message ?? "", /Reply posted.*Resolution failed/);
});
test("cache and drafts are persisted on disk", async (t) => {
    const { storage } = await setup(t);
    await storage.initialize();
    await Promise.all([
        storage.save([makePR(meta())]),
        storage.saveState({
            selected: 1,
            views: { "1": { file: "test.ts", panel: "diff", scroll: 20 } },
            drafts: { "1:thread1": "Draft" },
        }),
    ]);
    assert.equal((await storage.load())[0].head, meta().head);
    assert.equal((await storage.loadState()).drafts["1:thread1"], "Draft");
});
test("diff parsing preserves line numbers and handles large patches", () => {
    const lines = parsePatch("@@ -2,2 +2,2 @@\n-old\n+new\n same");
    assert.deepEqual(
        lines.slice(1).map((l) => [l.kind, l.old, l.next]),
        [
            ["del", "2", ""],
            ["add", "", "2"],
            ["context", "3", "3"],
        ],
    );
    assert.equal(
        parsePatch(`@@ -0,0 +1,100000 @@\n${"+line\n".repeat(100000)}`).length,
        100001,
    );
    assert.equal(patchComplete(file), true);
    assert.equal(patchComplete({ ...file, additions: 5 }), false);
});
test("HTTP boundary rejects cross-origin writes, invalid tokens, and malformed commands", async (t) => {
    const { service } = await setup(t);
    const { server, stopStreams } = createInboxServer(service, new Map());
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    t.after(() => {
        stopStreams();
        server.closeAllConnections();
        server.close();
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    assert.equal(
        (
            await fetch(`${url}/api/bootstrap`, {
                headers: { Origin: "https://evil.example" },
            })
        ).status,
        403,
    );
    assert.equal(
        (await fetch(`${url}/api/command`, { method: "POST", body: "{}" }))
            .status,
        403,
    );
    const bootstrap = (await (await fetch(`${url}/api/bootstrap`)).json()) as {
        token: string;
    };
    assert.equal(
        (
            await fetch(`${url}/api/command`, {
                method: "POST",
                headers: { "X-Inbox-Token": bootstrap.token },
                body: '{"action":"merge","number":1,"head":"wrong"}',
            })
        ).status,
        400,
    );
    assert.throws(() => parseCommand({ action: "resolve", number: "1" }));
    assert.throws(() => parseState({ drafts: {}, views: null }));
});

test("one failed discussion source stays an error after other sources finish", async (t) => {
    const github = provider();
    const gate = deferred<Page<Activity>>();
    github.comments = async (_number, kind) => {
        if (kind === "comments") throw new Error("comments unavailable");
        return gate.promise;
    };
    const { service } = await setup(t, github);
    await service.start();
    await until(() => service.prs.has(1));
    gate.resolve({ items: [] });
    await until(() => service.prs.get(1)?.comments.status === "error");
    assert.match(
        service.prs.get(1)?.comments.error ?? "",
        /comments unavailable/,
    );
    assert.equal(service.prs.get(1)?.comments.data[0]?.type, "thread");
});
test("full diff fallback distinguishes a complete patch from omitted content", async (t) => {
    const { gateway } = await setup(t);
    const pr = makePR(meta());
    pr.files.data = [{ ...file, patch: undefined }];
    const files = await gateway.patch(pr);
    assert.equal(files[0].patch, file.patch);
    assert.equal(files[0].partial, false);
    pr.files.data = [{ ...file, path: "missing.ts", patch: undefined }];
    const missing = await gateway.patch(pr);
    assert.match(missing[0].unavailable ?? "", /omitted/);
});
