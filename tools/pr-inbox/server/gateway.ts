import {
    makePR,
    orderActivities,
    revision,
    type Activity,
    type Check,
    type FileChange,
    type PRMeta,
    type PullRequest,
    type SectionName,
    type UserState,
} from "../model";
import type { MergeMethod, Page, Provider } from "./github";
import { Scheduler } from "./scheduler";
import type { Storage } from "./storage";
export class RevisionChanged extends Error {
    constructor(readonly meta: PRMeta) {
        super("The PR changed while loading. Fetching the new revision.");
    }
}
export class Gateway {
    private readonly scheduler = new Scheduler();
    constructor(
        private readonly provider: Provider,
        private readonly storage: Storage,
    ) {}
    async load(): Promise<PullRequest[]> {
        await this.storage.initialize();
        const records = await this.storage.load();
        return records
            .filter(
                (p) =>
                    p &&
                    Number.isInteger(p.number) &&
                    p.head &&
                    p.files &&
                    p.comments &&
                    p.checks,
            )
            .map((p) => {
                for (const name of ["files", "comments", "checks"] as const)
                    if (p[name].status === "loading") p[name].status = "idle";
                return p;
            });
    }
    prioritize(numbers: number[]): void {
        this.scheduler.prioritize(numbers);
    }
    save(prs: PullRequest[]): Promise<void> {
        return this.storage.save(prs);
    }
    loadState(): Promise<UserState> {
        return this.storage.loadState();
    }
    saveState(state: UserState): Promise<void> {
        return this.storage.saveState(state);
    }
    list(cursor?: string): Promise<Page<PRMeta>> {
        return this.scheduler.request(`list:${cursor ?? ""}`, 0, () =>
            this.provider.list(cursor),
        );
    }
    meta(number: number): Promise<PRMeta> {
        return this.scheduler.request(`meta:${number}`, number, () =>
            this.provider.meta(number),
        );
    }
    private read<T>(
        pr: PRMeta,
        key: string,
        run: () => Promise<T>,
    ): Promise<T> {
        return this.scheduler.request(
            `${pr.number}:${revision(pr)}:${key}`,
            pr.number,
            run,
        );
    }
    async files(
        pr: PullRequest,
        update: (files: FileChange[]) => void,
    ): Promise<FileChange[]> {
        const files: FileChange[] = [];
        let page: string | undefined;
        do {
            const result = await this.read(pr, `files:${page ?? ""}`, () =>
                this.provider.files(pr.number, page),
            );
            const actual = await this.meta(pr.number);
            if (revision(actual) !== revision(pr))
                throw new RevisionChanged(actual);
            files.push(
                ...result.items.map((file) => ({
                    ...file,
                    partial: !patchComplete(file),
                })),
            );
            update([...files]);
            page = result.next;
        } while (page);
        if (files.length < pr.fileCount)
            throw new Error(
                `GitHub returned ${files.length} of ${pr.fileCount} files. The file list is incomplete.`,
            );
        return files;
    }
    async comments(
        pr: PullRequest,
        update: (items: Activity[]) => void,
    ): Promise<Activity[]> {
        const items: Activity[] = [];
        const publish = () => update(orderActivities(items));
        await allReads(
            (["comments", "reviews"] as const)
                .map(async (kind) => {
                    let page: string | undefined;
                    do {
                        const result = await this.read(
                            pr,
                            `${kind}:${page ?? ""}`,
                            () => this.provider.comments(pr.number, kind, page),
                        );
                        items.push(...result.items);
                        publish();
                        page = result.next;
                    } while (page);
                })
                .concat([
                    (async () => {
                        let cursor: string | undefined;
                        do {
                            const result = await this.read(
                                pr,
                                `threads:${cursor ?? ""}`,
                                () => this.provider.threads(pr.number, cursor),
                            );
                            for (const thread of result.items) {
                                items.push(thread);
                                publish();
                                let replyCursor = thread.nextReply;
                                while (replyCursor) {
                                    const next = replyCursor;
                                    const replies = await this.read(
                                        pr,
                                        `replies:${thread.id}:${next}`,
                                        () =>
                                            this.provider.replies(
                                                thread.id,
                                                next,
                                            ),
                                    );
                                    thread.messages.push(...replies.items);
                                    publish();
                                    replyCursor = replies.next;
                                }
                            }
                            cursor = result.next;
                        } while (cursor);
                    })(),
                ]),
        );
        return orderActivities(items);
    }
    async checks(
        pr: PullRequest,
        update: (items: Check[]) => void,
    ): Promise<Check[]> {
        const items = new Map<string, Check>();
        const sorted = () =>
            [...items.values()].sort((a, b) => {
                const rank = {
                    fail: 0,
                    cancel: 1,
                    pending: 2,
                    unknown: 3,
                    pass: 4,
                    skip: 5,
                };
                return (
                    rank[a.status] - rank[b.status] ||
                    a.name.localeCompare(b.name)
                );
            });
        await allReads(
            (["checks", "statuses"] as const).map(async (kind) => {
                let page: string | undefined;
                do {
                    const result = await this.read(
                        pr,
                        `${kind}:${page ?? ""}`,
                        () => this.provider[kind](pr.head, page),
                    );
                    for (const item of result.items)
                        if (!items.has(item.id)) items.set(item.id, item);
                    update(sorted());
                    page = result.next;
                } while (page);
            }),
        );
        return sorted();
    }
    async patch(pr: PullRequest): Promise<FileChange[]> {
        const text = await this.read(pr, "full-diff", () =>
            this.provider.fullDiff(pr.number),
        );
        const actual = await this.meta(pr.number);
        if (revision(pr) !== revision(actual))
            throw new RevisionChanged(actual);
        const blocks = text.split(/^diff --git /m);
        return pr.files.data.map((file) => {
            const block = blocks.find((part) => {
                const first = part.split("\n", 1)[0];
                return (
                    first.endsWith(` b/${file.path}`) ||
                    first.endsWith(` "b/${file.path}"`)
                );
            });
            if (!block)
                return {
                    ...file,
                    unavailable:
                        "GitHub omitted this patch. Open the file on GitHub.",
                };
            const start = block.indexOf("\n@@ ");
            if (start < 0)
                return {
                    ...file,
                    patch: "",
                    unavailable: /Binary files|GIT binary patch/.test(block)
                        ? "Binary file — no text diff."
                        : "No text changes (rename or file mode change).",
                };
            const patch = block.slice(start + 1).trimEnd();
            return {
                ...file,
                patch,
                partial: !patchComplete({ ...file, patch }),
                unavailable: patchComplete({ ...file, patch })
                    ? undefined
                    : "GitHub returned a partial patch. Open the complete file on GitHub.",
            };
        });
    }
    merge(pr: PRMeta, method: MergeMethod): Promise<string> {
        return this.provider.merge(pr, method);
    }
    reply(
        number: number,
        activity: Activity | undefined,
        body: string,
    ): Promise<void> {
        return this.provider.reply(number, activity, body);
    }
    resolve(id: string, resolved: boolean): Promise<void> {
        return this.provider.resolve(id, resolved);
    }
    async close(): Promise<void> {
        this.scheduler.close();
        await this.storage.flush();
    }
}
export function patchComplete(file: FileChange): boolean {
    if (file.patch === undefined) return false;
    const lines = file.patch.split("\n");
    return (
        lines.filter((l) => l.startsWith("+")).length >= file.additions &&
        lines.filter((l) => l.startsWith("-")).length >= file.deletions
    );
}
export function reconcile(meta: PRMeta, old?: PullRequest): PullRequest {
    if (!old) return makePR(meta);
    const same = revision(meta) === revision(old);
    const mergeabilityPending =
        meta.mergeable === "UNKNOWN" && meta.mergeState === "UNKNOWN";
    return {
        ...old,
        ...meta,
        mergeable: mergeabilityPending ? old.mergeable : meta.mergeable,
        mergeState: mergeabilityPending ? old.mergeState : meta.mergeState,
        files: same ? old.files : { data: [], status: "idle" },
        checks:
            meta.head !== old.head
                ? { data: [], status: "idle" }
                : meta.ci === old.ci
                  ? old.checks
                  : { ...old.checks, status: "idle", error: undefined },
    };
}
export function invalidate(pr: PullRequest, section: SectionName): PullRequest {
    return {
        ...pr,
        [section]: { ...pr[section], status: "idle", error: undefined },
    };
}

async function allReads(reads: Promise<unknown>[]): Promise<void> {
    const results = await Promise.allSettled(reads);
    const errors = results.filter((result) => result.status === "rejected");
    if (errors.length > 0)
        throw new Error(
            errors.map((result) => String(result.reason)).join("; "),
        );
}
