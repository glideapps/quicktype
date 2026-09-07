import type {
    Command,
    InboxEvent,
    InboxStatus,
    PullRequest,
    UserState,
    ViewState,
} from "../model";
import { revision } from "../model";
import type { DiffLine } from "./diff";
export class InboxClient {
    readonly prs = new Map<number, PullRequest>();
    status?: InboxStatus;
    user: UserState = { views: {}, drafts: {} };
    selected?: number;
    displayed?: PullRequest;
    online = false;
    private token = "";
    private events?: EventSource;
    private readonly worker = new Worker("/diff-worker.js", { type: "module" });
    private readonly parsed = new Map<string, DiffLine[]>();
    private readonly requested = new Map<string, string>();
    private persistTimer?: ReturnType<typeof setTimeout>;
    private selectionTimer?: ReturnType<typeof setTimeout>;
    private readonly listeners = new Set<() => void>();
    private frame = 0;
    private booting = false;
    private connecting = false;
    private readonly failedPatches = new Set<string>();
    private readonly patchProblems = new Map<string, string>();
    constructor() {
        this.worker.onmessage = (
            event: MessageEvent<{ key: string; lines: DiffLine[] }>,
        ) => {
            const { key, lines } = event.data;
            if (this.parsed.size > 120) {
                const oldest = this.parsed.keys().next().value;
                if (oldest) {
                    this.parsed.delete(oldest);
                    this.requested.delete(oldest);
                }
            }
            this.parsed.set(key, lines);
            this.notify();
        };
        this.worker.onerror = () => {
            this.status = {
                ...(this.status ?? this.emptyStatus()),
                error: "Diff worker failed. Reload to retry.",
            };
            this.notify();
        };
    }
    subscribe(listener: () => void): void {
        this.listeners.add(listener);
    }
    private notify(): void {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            if (this.selected === undefined && this.prs.size > 0)
                this.select(
                    this.prs.has(this.user.selected ?? -1)
                        ? (this.user.selected ?? this.list()[0].number)
                        : this.list()[0].number,
                );
            for (const listener of this.listeners) listener();
        });
    }
    private emptyStatus(): InboxStatus {
        return { repo: "", since: "", cutoff: "", loading: true };
    }
    async start(): Promise<void> {
        if (this.booting) return;
        this.booting = true;
        try {
            const response = await fetch("/api/bootstrap");
            if (!response.ok)
                throw new Error("Cannot connect to the local inbox.");
            const data = (await response.json()) as {
                token: string;
                status: InboxStatus;
                state: UserState;
            };
            this.token = data.token;
            this.status = data.status;
            if (!this.selected) this.user = data.state;
            this.events?.close();
            const events = new EventSource(`/api/events?token=${this.token}`);
            this.events = events;
            this.connecting = true;
            events.onopen = () => {
                if (this.events !== events) return;
                this.online = true;
                this.connecting = false;
                this.notify();
            };
            events.onmessage = (event) => {
                if (this.events === events)
                    this.receive(JSON.parse(event.data) as InboxEvent);
            };
            events.onerror = () => {
                if (this.events !== events) return;
                this.online = false;
                this.connecting = false;
                this.notify();
            };
        } catch (error) {
            this.status = {
                ...(this.status ?? this.emptyStatus()),
                error: String(error),
            };
            this.notify();
        } finally {
            this.booting = false;
        }
    }
    async activate(): Promise<void> {
        if (this.online || this.connecting) return;
        await this.start();
    }
    private receive(event: InboxEvent): void {
        if (event.type === "snapshot") {
            const present = new Set(event.numbers);
            for (const number of this.prs.keys())
                if (!present.has(number)) this.prs.delete(number);
            if (this.selected !== undefined && !present.has(this.selected)) {
                this.selected = undefined;
                this.displayed = undefined;
            }
        }
        if (event.type === "status") this.status = event.status;
        if (event.type === "pr") {
            const old = this.prs.get(event.pr.number);
            this.prs.set(event.pr.number, event.pr);
            if (this.selected === event.pr.number) this.displayed = event.pr;

            if (!old || old.files.data !== event.pr.files.data)
                this.prepare(event.pr);
        }
        if (event.type === "remove") {
            const list = this.list(),
                index = list.findIndex((p) => p.number === event.number);
            this.prs.delete(event.number);
            if (this.selected === event.number) {
                this.selected = undefined;
                this.displayed = undefined;
                const next = this.list()[Math.min(index, this.prs.size - 1)];
                if (next) this.select(next.number);
            }
        }
        this.notify();
    }
    list(): PullRequest[] {
        return [...this.prs.values()].sort(
            (a, b) =>
                b.createdAt.localeCompare(a.createdAt) || b.number - a.number,
        );
    }
    select(number: number): void {
        const pr = this.prs.get(number);
        if (!pr) return;
        this.selected = number;
        this.user.selected = number;
        this.displayed = pr;
        this.prepare(pr);
        clearTimeout(this.selectionTimer);
        // A debounce affects scheduling only; selection paints immediately.
        this.selectionTimer = setTimeout(
            () =>
                void this.command({ action: "select", number }).catch(() => {}),
            60,
        );
        this.persist();
    }
    view(): ViewState {
        const id = String(this.selected ?? "");
        this.user.views[id] ??= { file: "", panel: "diff", scroll: 0 };
        return this.user.views[id];
    }
    changeFile(path: string): void {
        this.view().file = path;
        this.view().panel = "diff";
        this.view().scroll = 0;
        if (this.displayed) this.prepare(this.displayed);
        this.persist();
    }
    private key(pr: PullRequest, path: string): string {
        return `${pr.number}:${revision(pr)}:${path}`;
    }
    lines(pr: PullRequest, path: string): DiffLine[] | undefined {
        const key = this.key(pr, path),
            result = this.parsed.get(key);
        if (!result) this.prepare(pr);
        return result;
    }
    private prepare(pr: PullRequest): void {
        const selectedPath =
            this.user.views[String(pr.number)]?.file || pr.files.data[0]?.path;
        const selectedIndex = pr.files.data.findIndex(
            (f) => f.path === selectedPath,
        );
        pr.files.data.forEach((file, index) => {
            if (
                pr.number === this.selected
                    ? Math.abs(index - selectedIndex) > 2
                    : index > 0
            )
                return;
            if (!file.patch) return;
            const key = this.key(pr, file.path),
                same = this.requested.get(key) === file.patch;
            const foreground =
                pr.number === this.selected && file.path === selectedPath;
            if (same && (this.parsed.has(key) || !foreground)) return;
            if (!same) this.parsed.delete(key);
            this.requested.set(key, file.patch);
            this.worker.postMessage({
                key,
                patch: file.patch,
                priority: foreground
                    ? 0
                    : pr.number === this.selected
                      ? 1
                      : index === 0
                        ? 2
                        : 3,
            });
        });
    }
    patchError(pr: PullRequest): string | undefined {
        return this.patchProblems.get(`${pr.number}:${revision(pr)}`);
    }
    retryPatch(pr: PullRequest): void {
        const key = `${pr.number}:${revision(pr)}`;
        this.failedPatches.delete(key);
        this.patchProblems.delete(key);
        void this.completePatch(pr);
        this.notify();
    }
    async completePatch(pr: PullRequest): Promise<void> {
        const key = `${pr.number}:${revision(pr)}`;
        if (this.failedPatches.has(key)) return;
        this.failedPatches.add(key);
        try {
            await this.command({
                action: "patch",
                number: pr.number,
                head: pr.head,
            });
        } catch (error) {
            this.patchProblems.set(key, String(error));
            this.notify();
        }
    }
    async command(command: Command): Promise<{ message?: string }> {
        return this.post("/api/command", command);
    }
    private async post<T>(path: string, body: unknown): Promise<T> {
        const response = await fetch(path, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Inbox-Token": this.token,
            },
            body: JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Request failed.");
        return result as T;
    }
    persist(): void {
        clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(
            () => void this.post("/api/state", this.user).catch(() => {}),
            200,
        );
    }
    async flush(): Promise<void> {
        clearTimeout(this.persistTimer);
        await this.post("/api/state", this.user);
    }
}
