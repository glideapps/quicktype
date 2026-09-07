import type {
    Activity,
    Command,
    InboxEvent,
    InboxStatus,
    PullRequest,
    SectionName,
    UserState,
} from "../model";
import { AutoMergeCleanStatus, canMergeDirectly, revision } from "../model";
import type { MergeMethod } from "./github";
import {
    type Gateway,
    invalidate,
    reconcile,
    RevisionChanged,
} from "./gateway";
export class InboxService {
    readonly prs = new Map<number, PullRequest>();
    readonly status: InboxStatus;
    private readonly subscribers = new Set<(event: InboxEvent) => void>();
    private readonly loading = new Set<string>();
    private readonly mutations = new Set<number>();
    private readonly refreshTimers: ReturnType<typeof setInterval>[] = [];
    private saveTimer?: ReturnType<typeof setTimeout>;
    private selected?: number;
    private listing = false;
    private refreshPending = false;
    private stopped = false;
    constructor(
        private readonly gateway: Gateway,
        repo: string,
        since: string,
        cutoff: string,
        private readonly method: MergeMethod,
    ) {
        this.status = { repo, since, cutoff, loading: true };
    }
    async start(): Promise<void> {
        try {
            for (const pr of await this.gateway.load())
                if (pr.createdAt >= this.status.cutoff && !pr.merged)
                    this.prs.set(pr.number, pr);
        } catch (error) {
            this.status.error = `Cache: ${errorMessage(error)}`;
        }
        for (const pr of this.prs.values()) this.emit({ type: "pr", pr });
        this.emitStatus();
        void this.refresh();
        this.refreshTimers.push(setInterval(() => void this.refresh(), 30000));
    }
    subscribe(callback: (event: InboxEvent) => void): () => void {
        callback({ type: "snapshot", numbers: [...this.prs.keys()] });
        callback({ type: "status", status: this.status });
        for (const pr of this.sorted()) callback({ type: "pr", pr });
        this.subscribers.add(callback);
        return () => {
            this.subscribers.delete(callback);
        };
    }
    private emit(event: InboxEvent): void {
        for (const callback of this.subscribers) callback(event);
    }
    private emitStatus(): void {
        this.emit({ type: "status", status: { ...this.status } });
    }
    private sorted(): PullRequest[] {
        return [...this.prs.values()].sort(
            (a, b) =>
                b.createdAt.localeCompare(a.createdAt) || b.number - a.number,
        );
    }
    private put(pr: PullRequest): void {
        if (this.stopped) return;
        this.prs.set(pr.number, pr);
        this.emit({ type: "pr", pr });
        this.saveSoon();
    }
    private saveSoon(): void {
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = undefined;
            void this.gateway.save(this.sorted()).catch((error) => {
                this.status.error = `Cache: ${errorMessage(error)}`;
                this.emitStatus();
            });
        }, 400);
    }
    async refresh(): Promise<void> {
        if (this.listing || this.stopped) return;
        this.listing = true;
        this.refreshPending = false;
        this.status.loading = true;
        this.emitStatus();
        const seen = new Set<number>();
        try {
            let cursor: string | undefined;
            let done = false;
            do {
                const page = await this.gateway.list(cursor);
                if (this.stopped) return;
                for (const meta of page.items) {
                    if (meta.createdAt < this.status.cutoff) {
                        done = true;
                        continue;
                    }
                    seen.add(meta.number);
                    this.put(reconcile(meta, this.prs.get(meta.number)));
                }
                if (!this.selected && this.prs.size > 0)
                    this.select(this.sorted()[0].number);
                this.warm();
                cursor = page.next;
            } while (cursor && !done);
            for (const number of this.prs.keys())
                if (!seen.has(number)) {
                    this.prs.delete(number);
                    this.emit({ type: "remove", number });
                }
            if (this.selected) this.refreshDetails(this.selected);
            this.status.syncedAt = new Date().toISOString();
            this.status.error = undefined;
            this.saveSoon();
        } catch (error) {
            this.status.error = errorMessage(error);
        } finally {
            this.status.loading = false;
            this.listing = false;
            this.emitStatus();
            if (this.refreshPending) void this.refresh();
        }
    }
    private select(number: number): void {
        if (!this.prs.has(number)) return;
        const previous = this.selected;
        this.selected = number;
        const list = this.sorted().map((pr) => pr.number),
            index = list.indexOf(number);
        const direction =
            previous !== undefined && list.indexOf(previous) > index ? -1 : 1;
        const neighbors = [
            number,
            list[index + direction],
            list[index + 2 * direction],
            list[index - direction],
        ].filter((n): n is number => n !== undefined);
        this.gateway.prioritize(neighbors);
        this.warm();
        this.refreshDetails(number, true);
    }
    private warm(): void {
        const list = this.sorted();
        list.sort(
            (a, b) =>
                Number(b.number === this.selected) -
                Number(a.number === this.selected),
        );
        for (const pr of list)
            for (const section of ["files", "comments", "checks"] as const)
                if (pr[section].status === "idle")
                    void this.load(pr.number, section);
    }
    private async load(
        number: number,
        section: SectionName,
        force = false,
    ): Promise<void> {
        const original = this.prs.get(number);
        if (!original || this.stopped) return;
        const key = `${number}:${revision(original)}:${section}`;
        if (
            this.loading.has(key) ||
            (!force && original[section].status === "ready")
        )
            return;
        this.loading.add(key);
        this.put({
            ...original,
            [section]: {
                ...original[section],
                status: "loading",
                error: undefined,
            },
        });
        const apply = (data: unknown, complete: boolean) => {
            const current = this.prs.get(number);
            if (!current || revision(current) !== revision(original)) return;
            this.put({
                ...current,
                [section]: {
                    data,
                    status: complete ? "ready" : "loading",
                    updatedAt: complete
                        ? new Date().toISOString()
                        : current[section].updatedAt,
                },
            } as PullRequest);
        };
        try {
            const result = await this.gateway[section](original, (data) => {
                if (!original[section].updatedAt) apply(data, false);
            });
            apply(result, true);
        } catch (error) {
            if (error instanceof RevisionChanged) {
                this.put(reconcile(error.meta, this.prs.get(number)));
                this.warm();
            } else {
                const current = this.prs.get(number);
                if (current && revision(current) === revision(original))
                    this.put({
                        ...current,
                        [section]: {
                            ...current[section],
                            status: "error",
                            error: errorMessage(error),
                        },
                    });
            }
        } finally {
            this.loading.delete(key);
        }
    }
    private refreshDetails(number: number, onlyStale = false): void {
        for (const section of ["comments", "checks"] as const) {
            const data = this.prs.get(number)?.[section];
            if (
                data &&
                (data.status === "ready" || data.status === "error") &&
                (!onlyStale ||
                    !data.updatedAt ||
                    Date.now() - Date.parse(data.updatedAt) >= 30000)
            )
                void this.load(number, section, true);
        }
    }
    loadState(): Promise<UserState> {
        return this.gateway.loadState();
    }
    saveState(state: UserState): Promise<void> {
        return this.gateway.saveState(state);
    }
    async command(command: Command): Promise<{ message?: string }> {
        if (command.action === "refresh") {
            void this.refresh();
            return {};
        }
        const pr = this.prs.get(command.number);
        if (!pr) throw new Error("PR is no longer in this inbox.");
        if (command.action === "select") {
            this.select(command.number);
            return {};
        }
        if (command.action === "retry") {
            this.put(invalidate(pr, command.section));
            void this.load(pr.number, command.section, true);
            return {};
        }
        if (command.action === "patch") {
            if (command.head !== pr.head)
                throw new Error(
                    "This revision changed. Load the new revision first.",
                );
            const files = await this.gateway.patch(pr);
            const current = this.prs.get(pr.number);
            if (current && revision(current) === revision(pr))
                this.put({
                    ...current,
                    files: { ...current.files, data: files },
                });
            return {};
        }
        if (this.mutations.has(pr.number))
            throw new Error("An action is already pending for this PR.");
        this.mutations.add(pr.number);
        try {
            if (command.action === "merge") {
                const fresh = await this.gateway.meta(pr.number);
                this.put(reconcile(fresh, this.prs.get(pr.number)));
                if (fresh.merged) {
                    this.remove(pr.number);
                    return { message: "Already merged" };
                }
                if (fresh.head !== command.head)
                    throw new Error(
                        "New commits arrived. Read the new revision before merging.",
                    );
                if (fresh.draft) throw new Error("This PR is a draft.");
                if (fresh.autoMerge && !canMergeDirectly(fresh))
                    return { message: "Auto-merge already enabled" };
                let message: string;
                try {
                    message = await this.gateway.merge(fresh, this.method);
                } catch (error) {
                    const actual = await this.gateway
                        .meta(pr.number)
                        .catch(() => undefined);
                    if (actual)
                        this.put(reconcile(actual, this.prs.get(pr.number)));
                    if (actual?.merged) {
                        this.remove(pr.number);
                        return { message: "Merged" };
                    }
                    if (actual?.autoMerge)
                        return { message: "Auto-merge enabled" };
                    if (error instanceof AutoMergeCleanStatus) {
                        if (!actual)
                            throw new Error(
                                "Could not refresh merge readiness. Try again.",
                                { cause: error },
                            );
                        if (actual.head !== command.head)
                            throw new Error(
                                "New commits arrived. Read the new revision before merging.",
                                { cause: error },
                            );
                        if (canMergeDirectly(actual)) {
                            try {
                                message = await this.gateway.merge(
                                    actual,
                                    this.method,
                                );
                            } catch (retryError) {
                                const final = await this.gateway
                                    .meta(pr.number)
                                    .catch(() => undefined);
                                if (final)
                                    this.put(
                                        reconcile(
                                            final,
                                            this.prs.get(pr.number),
                                        ),
                                    );
                                if (final?.merged) {
                                    this.remove(pr.number);
                                    return { message: "Merged" };
                                }
                                throw retryError;
                            }
                        } else {
                            const detail = actual.draft
                                ? "This PR is a draft."
                                : actual.mergeable === "CONFLICTING" ||
                                    actual.mergeState === "DIRTY"
                                  ? "This PR has merge conflicts."
                                  : actual.ci !== "pass"
                                    ? "GitHub cannot enable auto-merge while CI is not green."
                                    : "GitHub is still calculating mergeability.";
                            throw new Error(detail, { cause: error });
                        }
                    } else throw error;
                }
                if (message === "Merged") {
                    this.remove(pr.number);
                } else
                    this.put({
                        ...(this.prs.get(pr.number) ?? pr),
                        autoMerge: true,
                    });
                return { message };
            }
            const activity = pr.comments.data.find(
                (a) => a.id === command.activityId,
            );
            if (command.activityId && !activity)
                throw new Error(
                    "Comment is no longer available. Refresh comments first.",
                );
            if (command.action === "resolve") {
                if (activity?.type !== "thread")
                    throw new Error("Only inline threads can be resolved.");
                await this.gateway.resolve(activity.id, command.resolved);
                this.updateThread(pr.number, activity.id, command.resolved);
                return {
                    message: command.resolved
                        ? "Thread resolved"
                        : "Thread reopened",
                };
            }
            const body = command.body.trim();
            if (!body || body.length > 65000)
                throw new Error("Reply must contain 1–65,000 characters.");
            await this.gateway.reply(pr.number, activity, body);
            let message = "Reply posted";
            if (command.resolve && activity?.type === "thread") {
                try {
                    await this.gateway.resolve(activity.id, true);
                    this.updateThread(pr.number, activity.id, true);
                } catch (error) {
                    message += `. Resolution failed: ${errorMessage(error)}. Use Resolve to retry.`;
                }
            }
            void this.load(pr.number, "comments", true);
            return { message };
        } finally {
            this.mutations.delete(pr.number);
        }
    }
    private remove(number: number): void {
        this.prs.delete(number);
        this.emit({ type: "remove", number });
        this.saveSoon();
        this.refreshPending = true;
        void this.refresh();
    }
    private updateThread(number: number, id: string, resolved: boolean): void {
        const pr = this.prs.get(number);
        if (pr)
            this.put({
                ...pr,
                comments: {
                    ...pr.comments,
                    data: pr.comments.data.map((a: Activity) =>
                        a.id === id ? { ...a, resolved } : a,
                    ),
                },
            });
    }
    async close(): Promise<void> {
        this.stopped = true;
        for (const timer of this.refreshTimers) clearInterval(timer);
        clearTimeout(this.saveTimer);
        await this.gateway.save(this.sorted());
        await this.gateway.close();
    }
}
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
