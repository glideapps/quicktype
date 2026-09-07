import { InboxClient } from "./client";
import {
    canMergeDirectly,
    hasConflicts,
    latest,
    revision,
    type Activity,
    type FileChange,
    type PullRequest,
    type Section,
} from "../model";
import type { DiffLine } from "./diff";
const client = new InboxClient();
const element = <T extends HTMLElement = HTMLElement>(id: string): T =>
    document.getElementById(id) as T;
const modal = element<HTMLDialogElement>("modal");
const esc = (value: unknown): string =>
    String(value).replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c] ?? c,
    );
const safeURL = (value: string): string => {
    try {
        const url = new URL(value);
        return url.protocol === "https:" ? esc(url.href) : "#";
    } catch {
        return "#";
    }
};
function inline(text: string): string {
    return esc(text)
        .replace(
            /\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g,
            (_all, label: string, url: string) =>
                `<a href="${safeURL(url.replace(/&amp;/g, "&"))}" target="_blank" rel="noreferrer">${label}</a>`,
        )
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`\n]+)`/g, "<code>$1</code>");
}
function markdown(raw: string): string {
    return raw
        .replace(/<!--[\s\S]*?-->/g, "")
        .split(/(```[\s\S]*?```)/g)
        .map((part) => {
            if (part.startsWith("```"))
                return `<pre><code>${esc(part.replace(/^```[^\n]*\n?/, "").replace(/```$/, ""))}</code></pre>`;
            return part
                .split("\n")
                .map((line) =>
                    /^#{1,6} /.test(line)
                        ? `<strong>${inline(line.replace(/^#{1,6} /, ""))}</strong>`
                        : inline(line),
                )
                .join("<br>");
        })
        .join("");
}
function age(time: string): string {
    const minutes = Math.max(
        0,
        Math.floor((Date.now() - Date.parse(time)) / 60000),
    );
    return minutes < 60
        ? `${minutes}m`
        : minutes < 1440
          ? `${Math.floor(minutes / 60)}h`
          : `${Math.floor(minutes / 1440)}d`;
}
const stamp = (time: string): string =>
    new Date(time).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
const symbol = (pr: PullRequest): string =>
    ({ pass: "✓", fail: "×", pending: "◷", unknown: "?" })[pr.ci];
const ciLabel = (pr: PullRequest): string =>
    ({
        pass: "CI green",
        fail: "CI failed",
        pending: "CI running",
        unknown: "CI unknown",
    })[pr.ci];
const count = (pr: PullRequest): number =>
    pr.comments.data.reduce((n, a) => n + a.messages.length, 0);
const htmlCache = new Map<string, string>();
let lastPR: number | undefined,
    pending = new Set<number>(),
    toastTimer: ReturnType<typeof setTimeout>;
let sendingReply = false;
let replyTarget: { number: number; activityId: string } | undefined;
let restoreFocus: HTMLElement | null = null;
let virtual:
    | { key: string; lines: DiffLine[]; first: number; last: number }
    | undefined;
const rowHeight = 20;
function setHTML(id: string, html: string): boolean {
    if (htmlCache.get(id) === html) return false;
    const target = element(id),
        scroll = target.scrollTop;
    htmlCache.set(id, html);
    target.innerHTML = html;
    target.scrollTop = scroll;
    return true;
}
function loading<T>(section: Section<T>, name: string): string {
    if (section.status === "error")
        return `<div class="load-error">${esc(section.error)} <button data-retry="${name}">Retry</button></div>`;
    if (section.status !== "ready" && !section.updatedAt)
        return `<div class="load-state">Loading ${name}…</div>`;
    return "";
}
function thread(activity: Activity): string {
    return `<article class="thread" data-timestamp="${latest(activity)}">${activity.type === "thread" ? `<div class="thread-head row"><span>${esc(activity.path)}:${activity.line ?? ""}</span>${activity.resolved ? "Resolved" : activity.outdated ? "Outdated" : ""}</div>` : ""}${activity.messages.map((m) => `<div class="comment-meta row"><b>${esc(m.author)}</b><a class="comment-time" href="${safeURL(m.url)}" target="_blank" rel="noreferrer" title="${esc(m.updatedAt)}">${stamp(m.updatedAt)}</a></div><div class="comment-body">${markdown(m.body)}</div>`).join("")}<div class="thread-actions row"><button data-reply="${esc(activity.id)}">Reply</button>${activity.type === "thread" ? `<button data-resolve="${esc(activity.id)}" data-resolved="${!activity.resolved}">${activity.resolved ? "Reopen" : "Resolve"}</button><button data-file-path="${esc(activity.path)}">Code ↗</button>` : ""}</div></article>`;
}
function comments(pr: PullRequest): string {
    return `${loading(pr.comments, "comments") + pr.comments.data.map(thread).join("") + ((pr.comments.status === "ready" || pr.comments.updatedAt) && pr.comments.data.length === 0 ? '<p class="empty-comments muted">No comments.</p>' : "")}<button class="new-comment plain" data-reply="">Add comment</button>`;
}
function checks(pr: PullRequest): string {
    return `${loading(pr.checks, "checks")}<div class="check-head muted">${esc(pr.head.slice(0, 7))} · ${pr.checks.data.length} checks</div>${pr.checks.data.map((c) => `<div class="check"><details><summary>${esc(c.name)}</summary><div class="check-summary">${markdown(c.detail)}</div><a href="${safeURL(c.url)}" target="_blank" rel="noreferrer">Open logs ↗</a></details><span class="${c.status === "pass" ? "plus" : c.status === "fail" || c.status === "cancel" ? "minus" : "muted"}">${esc(c.status)}</span></div>`).join("")}${(pr.checks.status === "ready" || pr.checks.updatedAt) && pr.checks.data.length === 0 ? '<p class="muted">No checks reported.</p>' : ""}`;
}
function currentFile(pr: PullRequest): FileChange | undefined {
    return (
        pr.files.data.find((f) => f.path === client.view().file) ??
        pr.files.data[0]
    );
}
function queue(): void {
    const list = client.list();
    const title = `${list.length} open · ${client.status?.since ?? ""}${client.status?.loading && list.length === 0 ? " · loading…" : ""}`;
    element("queue-count").textContent = title;
    setHTML(
        "queue-list",
        list
            .map(
                (pr) =>
                    `<button class="queue-item ${pr.number === client.selected ? "selected" : ""}" data-pr="${pr.number}" aria-current="${pr.number === client.selected}"><div class="row"><span class="ci-dot ${pr.ci}" title="${ciLabel(pr)}">${symbol(pr)}</span><span class="num">#${pr.number}</span><span class="grow"></span>${count(pr) ? `<span class="comment-count" title="Comments"><svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2.5h12v8H7l-4 3v-3H2z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg> ${count(pr)}</span>` : ""}${pr.files.status !== "ready" && pr.files.data.length === 0 ? '<span class="muted" title="Diff not loaded yet">·</span>' : ""}</div><div class="title">${esc(pr.title)}</div>${hasConflicts(pr) ? '<span class="badge bad">Conflicts</span>' : ""}${pr.autoMerge ? '<span class="badge wait">Auto-merge</span>' : ""}</button>`,
            )
            .join("") ||
            `<p class="pad muted">${client.status?.loading ? "Fetching PRs…" : "No open PRs in this window."}</p>`,
    );
}
function render(): void {
    queue();
    element("connection").textContent = client.online
        ? client.status?.loading
            ? "Syncing…"
            : ""
        : "Disconnected · cached data";
    element("connection").title = client.status?.syncedAt
        ? `Last synced ${stamp(client.status.syncedAt)}`
        : "";
    element("global-error").hidden = !client.status?.error;
    element("global-error").textContent = client.status?.error ?? "";
    const pr = client.displayed;
    if (!pr) {
        setHTML(
            "heading",
            `<p class="muted">${client.status?.loading ? "Loading PRs…" : "No PR selected."}</p>`,
        );
        for (const id of ["panel", "tabs", "description", "comments"])
            setHTML(id, "");
        return;
    }
    const changed = lastPR !== pr.number;
    const current = pr;
    const direct = canMergeDirectly(current);
    const busy = pending.has(pr.number);
    setHTML(
        "heading",
        `<div class="heading-top"><div class="pr-meta"><a href="${safeURL(pr.url)}" target="_blank" rel="noreferrer">#${pr.number} ↗</a><span>${esc(pr.author)}</span><span>${age(pr.createdAt)} ago</span>${pr.draft ? '<span class="badge neutral">Draft</span>' : ""}</div><button class="primary merge-button" data-action="merge" ${busy || current.draft || !client.online || (current.autoMerge && !direct) ? "disabled" : ""} title="${direct ? "Merge this revision (M)" : "Enable auto-merge (M)"}">${busy ? "Working…" : current.autoMerge && !direct ? "Auto-merge enabled" : direct ? "Merge" : "Enable auto-merge"}</button></div><h2>${esc(pr.title)}</h2>`,
    );
    const view = client.view();
    setHTML(
        "tabs",
        `<button data-panel="diff" class="${view.panel === "diff" ? "active" : ""}">Diff</button><button data-panel="comments" class="comments-tab ${view.panel === "comments" ? "active" : ""}">Comments ${count(pr) || ""}</button><button data-panel="checks" class="${view.panel === "checks" ? "active" : ""}"><span class="badge ${current.ci === "pass" ? "good" : current.ci === "fail" ? "bad" : "wait"}">${symbol(current)} ${ciLabel(current)}</span></button>${hasConflicts(current) ? '<span class="badge bad">Merge conflicts</span>' : current.mergeable === "UNKNOWN" ? '<span class="badge wait">Checking mergeability…</span>' : ""}<span class="grow"></span><span class="change-total"><span class="plus">+${pr.additions}</span> <span class="minus">−${pr.deletions}</span></span>`,
    );
    setHTML(
        "description",
        pr.description
            ? markdown(pr.description)
            : '<p class="muted">No description.</p>',
    );
    element("comments-label").textContent = `Comments ${count(pr) || ""}`;
    setHTML("comments", comments(pr));
    element("panel").classList.toggle("diff-panel", view.panel === "diff");
    if (view.panel === "diff") renderDiff(pr, changed);
    else {
        virtual = undefined;
        setHTML(
            "panel",
            view.panel === "checks"
                ? checks(current)
                : `<section class="pr-description"><div class="comments-label">Description</div><div class="description-full">${markdown(pr.description) || "No description."}</div></section><div class="comments-label">Comments ${count(pr) || ""}</div>${comments(pr)}`,
        );
        if (changed) element("panel").scrollTop = view.scroll;
    }
    if (changed) {
        element("description").scrollTop = 0;
        element("comments").scrollTop = 0;
        const selected = document.querySelector<HTMLElement>(
            ".queue-item.selected",
        );
        selected?.scrollIntoView({ block: "nearest" });
        element("announcement").textContent = `PR ${pr.number}: ${pr.title}`;
    }
    lastPR = pr.number;
}
function renderDiff(pr: PullRequest, changed: boolean): void {
    const file = currentFile(pr);
    if (!file) {
        virtual = undefined;
        setHTML(
            "panel",
            loading(pr.files, "files") ||
                '<p class="muted">No changed files.</p>',
        );
        return;
    }
    const index = pr.files.data.indexOf(file);
    const lines = file.patch ? client.lines(pr, file.path) : undefined;
    const key = `${pr.number}:${revision(pr)}:${file.path}`;
    if (file.partial && !file.unavailable && pr.files.status === "ready")
        void client.completePatch(pr);
    const patchError = client.patchError(pr);
    const notice = patchError
        ? `<div class="load-error">${esc(patchError)} <button data-action="retry-patch">Retry</button></div>`
        : file.unavailable
          ? `<div class="load-state">${esc(file.unavailable)} <a href="${safeURL(file.url)}" target="_blank" rel="noreferrer">Open file ↗</a></div>`
          : file.partial
            ? '<div class="load-state">Partial patch · loading full diff…</div>'
            : "";
    const controls = `<div class="file-title"><select id="file-select" aria-label="Changed file" title="${esc(file.path)}">${pr.files.data.map((f) => `<option value="${esc(f.path)}" ${f.path === file.path ? "selected" : ""}>${esc(f.path)}</option>`).join("")}</select><span class="file-position">${index + 1}/${pr.fileCount}</span><button data-action="prev-file" ${index === 0 ? "disabled" : ""} aria-label="Previous file">←</button><button data-action="next-file" ${index === pr.files.data.length - 1 ? "disabled" : ""} aria-label="Next file">→</button></div>`;
    const header = `${loading(pr.files, "files")}<div class="file">${controls}${file.previousPath ? `<div class="rename muted">Renamed from ${esc(file.previousPath)}</div>` : ""}${notice}<div id="diff-scroll" class="virtual-scroll" tabindex="0"><div id="diff-spacer"></div></div></div>`;
    const rebuilt = setHTML("panel", header);
    if (!lines) {
        virtual = undefined;
        element("diff-spacer").style.height = "";
        element("diff-spacer").style.minWidth = "";
        element("diff-spacer").innerHTML =
            file.unavailable || patchError
                ? ""
                : '<div class="pad muted">Preparing diff…</div>';
        if (!file.patch && !file.unavailable && pr.files.status === "ready")
            void client.completePatch(pr);
        return;
    }
    if (!virtual || virtual.key !== key || virtual.lines !== lines || rebuilt) {
        virtual = { key, lines, first: -1, last: -1 };
        const scroller = element("diff-scroll");
        scroller.onscroll = () => {
            if (client.displayed) {
                client.view().scroll = scroller.scrollTop;
                client.persist();
            }
            drawLines();
        };
        element("diff-spacer").style.height = `${lines.length * rowHeight}px`;
        element("diff-spacer").style.minWidth =
            `${lines.reduce((width, line) => Math.max(width, line.text.length), 0) * 6.6 + 120}px`;
        scroller.scrollTop =
            changed || rebuilt ? client.view().scroll : scroller.scrollTop;
        drawLines();
    }
}
function drawLines(): void {
    if (!virtual) return;
    const scroller = element("diff-scroll");
    if (!scroller) return;
    const first = Math.max(0, Math.floor(scroller.scrollTop / rowHeight) - 15);
    const last = Math.min(
        virtual.lines.length,
        first + Math.ceil(scroller.clientHeight / rowHeight) + 30,
    );
    if (first === virtual.first && last === virtual.last) return;
    virtual.first = first;
    virtual.last = last;
    element("diff-spacer").innerHTML = virtual.lines
        .slice(first, last)
        .map(
            (line, index) =>
                `<div class="virtual-line ${line.kind === "hunk" ? "hunk" : `line ${line.kind}`}" style="top:${(first + index) * rowHeight}px">${line.kind === "hunk" ? esc(line.text) : `<span class="ln">${line.old}</span><span class="ln">${line.next}</span><span class="sign">${line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span><code>${esc(line.text)}</code>`}</div>`,
        )
        .join("");
}
function movePR(delta: number): void {
    const list = client.list();
    if (list.length === 0) return;
    const index = list.findIndex((p) => p.number === client.selected);
    client.select(list[(index + delta + list.length) % list.length].number);
    render();
}
function moveFile(delta: number): void {
    const pr = client.displayed;
    if (!pr) return;
    const current = currentFile(pr);
    if (!current) return;
    const next = pr.files.data[pr.files.data.indexOf(current) + delta];
    if (next) {
        client.changeFile(next.path);
        render();
    } else if (pr.files.status !== "ready" && delta > 0)
        toast("More files are loading.");
}
function showPanel(panel: "diff" | "comments" | "checks"): void {
    if (panel === "comments" && matchMedia("(min-width:1151px)").matches) {
        element("comments").focus();
        return;
    }
    client.view().panel = panel;
    client.view().scroll = 0;
    client.persist();
    render();
    element("panel").focus();
}
function toast(message: string): void {
    element("toast").textContent = message;
    element("toast").classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
        () => element("toast").classList.remove("visible"),
        6000,
    );
}
function showDialog(html: string): void {
    restoreFocus = document.activeElement as HTMLElement;
    modal.innerHTML = html;
    modal.showModal();
}
modal.addEventListener("close", () => {
    if (restoreFocus?.isConnected) restoreFocus.focus();
});
function help(): void {
    showDialog(
        '<h2 id="modal-title">Shortcuts</h2><div class="key-list"><span><kbd>↑</kbd> <kbd>↓</kbd></span><span>Previous / next PR</span><span><kbd>←</kbd> <kbd>→</kbd></span><span>Previous / next file</span><span><kbd>D</kbd> <kbd>S</kbd></span><span>Diff / CI</span><span><kbd>C</kbd></span><span>Add comment</span><span><kbd>⌘ Enter</kbd></span><span>Post comment (Ctrl Enter also works)</span><span><kbd>M</kbd></span><span>Merge or enable auto-merge</span><span><kbd>⌘ K</kbd> <kbd>/</kbd></span><span>Find PR (Ctrl K also works)</span><span><kbd>Esc</kbd></span><span>Close dialog</span></div><div class="dialog-actions"><button data-action="close-modal">Close</button></div>',
    );
}
function searchResults(query: string): void {
    element("search-results").innerHTML =
        client
            .list()
            .filter((pr) =>
                `${pr.number} ${pr.title}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
            )
            .map(
                (pr) =>
                    `<button data-search-pr="${pr.number}">#${pr.number} · ${esc(pr.title)}</button>`,
            )
            .join("") || '<p class="muted">No matching PRs.</p>';
}
function search(): void {
    showDialog(
        '<h2 id="modal-title">Find PR</h2><label class="sr-only" for="search-input">PR number or title</label><input id="search-input" placeholder="Number or title…" autocomplete="off"><div id="search-results" class="search-results"></div><div class="dialog-actions"><button data-action="close-modal">Close</button></div>',
    );
    searchResults("");
    element("search-input").focus();
}
function reply(id: string): void {
    const pr = client.displayed;
    if (!pr) return;
    replyTarget = { number: pr.number, activityId: id };
    const activity = pr.comments.data.find((a) => a.id === id);
    const draft = client.user.drafts[`${pr.number}:${id}`] ?? "";
    showDialog(
        `<h2 id="modal-title">${id ? "Reply" : "Comment"} on #${pr.number}</h2><label class="sr-only" for="reply-body">Comment text</label><textarea id="reply-body" placeholder="Write a comment…">${esc(draft)}</textarea><div class="dialog-actions"><button data-action="close-modal">Cancel</button><button class="primary" data-action="send-reply" title="Post comment (⌘ Enter / Ctrl Enter)">Post <kbd>⌘ Enter</kbd></button>${activity?.type === "thread" ? '<button data-action="send-resolve">Post & resolve</button>' : ""}</div>`,
    );
    element("reply-body").focus();
}
async function merge(): Promise<void> {
    const pr = client.displayed;
    if (!pr || pending.has(pr.number)) return;
    pending.add(pr.number);
    render();
    try {
        const result = await client.command({
            action: "merge",
            number: pr.number,
            head: pr.head,
        });
        toast(`#${pr.number}: ${result.message}`);
        if (client.selected === pr.number) movePR(1);
    } catch (error) {
        toast(String(error));
    } finally {
        pending.delete(pr.number);
        render();
    }
}
async function sendReply(resolve: boolean): Promise<void> {
    if (!replyTarget || sendingReply) return;
    const target = replyTarget,
        input = element<HTMLTextAreaElement>("reply-body"),
        body = input.value.trim();
    if (!body) {
        input.focus();
        return;
    }
    sendingReply = true;
    const buttons = [...modal.querySelectorAll<HTMLButtonElement>("button")];
    buttons.forEach((b) => {
        b.disabled = true;
    });
    try {
        const result = await client.command({
            action: "reply",
            number: target.number,
            activityId: target.activityId,
            body,
            resolve,
        });
        client.user.drafts[`${target.number}:${target.activityId}`] = "";
        client.persist();
        modal.close();
        toast(result.message ?? "Reply posted");
    } catch (error) {
        toast(
            `${error}. Check GitHub before retrying if the connection failed after posting.`,
        );
    } finally {
        sendingReply = false;
        buttons.forEach((b) => {
            b.disabled = false;
        });
    }
}
document.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === "search-input") searchResults(input.value);
    if (input.id === "reply-body" && replyTarget) {
        client.user.drafts[`${replyTarget.number}:${replyTarget.activityId}`] =
            input.value;
        client.persist();
    }
});
document.addEventListener("change", (event) => {
    const input = event.target as HTMLSelectElement;
    if (input.id === "file-select") {
        client.changeFile(input.value);
        render();
        element("file-select").focus();
    }
});
document.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
        "button",
    );
    if (!button || button.disabled) return;
    if (button.dataset.pr) {
        client.select(+button.dataset.pr);
        render();
        return;
    }
    if (button.dataset.searchPr) {
        modal.close();
        client.select(+button.dataset.searchPr);
        render();
        return;
    }
    if (button.dataset.panel) {
        showPanel(button.dataset.panel as "diff" | "comments" | "checks");
        return;
    }
    if (button.dataset.reply !== undefined) {
        reply(button.dataset.reply);
        return;
    }
    if (button.dataset.filePath) {
        client.changeFile(button.dataset.filePath);
        render();
        return;
    }
    if (button.dataset.retry && client.selected) {
        void client
            .command({
                action: "retry",
                number: client.selected,
                section: button.dataset.retry as
                    | "files"
                    | "comments"
                    | "checks",
            })
            .catch((error) => toast(String(error)));
        return;
    }
    if (button.dataset.resolve && client.selected) {
        button.disabled = true;
        void client
            .command({
                action: "resolve",
                number: client.selected,
                activityId: button.dataset.resolve,
                resolved: button.dataset.resolved === "true",
            })
            .then((result) => toast(result.message ?? "Updated"))
            .catch((error) => toast(String(error)))
            .finally(() => {
                button.disabled = false;
            });
        return;
    }
    const actions: Record<string, () => void> = {
        "prev-pr": () => movePR(-1),
        "next-pr": () => movePR(1),
        "prev-file": () => moveFile(-1),
        "next-file": () => moveFile(1),
        search,
        help,
        merge: () => void merge(),
        "close-modal": () => modal.close(),
        "send-reply": () => void sendReply(false),
        "send-resolve": () => void sendReply(true),
        "retry-patch": () => {
            if (client.displayed) client.retryPatch(client.displayed);
        },
        refresh: () => {
            if (!client.online) void client.start();
            else
                void client
                    .command({ action: "refresh" })
                    .catch((error) => toast(String(error)));
        },
    };
    actions[button.dataset.action ?? ""]?.();
});
document.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (modal.open) {
        if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            event.target instanceof HTMLElement &&
            event.target.id === "reply-body"
        ) {
            event.preventDefault();
            if (!event.repeat) void sendReply(false);
            return;
        }
        if (
            event.key === "Enter" &&
            (event.target as HTMLElement).id === "search-input"
        )
            modal.querySelector<HTMLButtonElement>("[data-search-pr]")?.click();
        return;
    }
    if (
        event.target instanceof Element &&
        event.target.closest("input,textarea,select,[contenteditable=true]")
    )
        return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        search();
        return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const actions: Record<string, () => void> = {
        ArrowUp: () => movePR(-1),
        ArrowDown: () => movePR(1),
        ArrowLeft: () => moveFile(-1),
        ArrowRight: () => moveFile(1),
        d: () => showPanel("diff"),
        c: () => reply(""),
        s: () => showPanel("checks"),
        m: () => {
            if (!event.repeat) void merge();
        },
        "/": search,
        "?": help,
    };
    const action = actions[event.key] ?? actions[event.key.toLowerCase()];
    if (action) {
        event.preventDefault();
        action();
    }
});
element("panel").addEventListener("scroll", () => {
    if (client.view().panel !== "diff") {
        client.view().scroll = element("panel").scrollTop;
        client.persist();
    }
});
window.addEventListener("resize", () => {
    if (
        matchMedia("(min-width:1151px)").matches &&
        client.view().panel === "comments"
    )
        client.view().panel = "diff";
    if (virtual) {
        virtual.first = -1;
        drawLines();
    }
    render();
});
document.addEventListener("visibilitychange", () => {
    if (document.hidden) void client.flush().catch(() => {});
    else void client.activate();
});
globalThis.addEventListener("focus", () => void client.activate());
globalThis.addEventListener("online", () => {
    if (!document.hidden) void client.activate();
});
client.subscribe(render);
void client.start();
