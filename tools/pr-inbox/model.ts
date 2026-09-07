export type CI = "pass" | "fail" | "pending" | "unknown";
export type SectionName = "files" | "comments" | "checks";
export interface Section<T> {
    data: T;
    status: "idle" | "loading" | "ready" | "error";
    updatedAt?: string;
    error?: string;
}
export interface FileChange {
    path: string;
    previousPath?: string;
    additions: number;
    deletions: number;
    patch?: string;
    partial?: boolean;
    url: string;
    unavailable?: string;
}
export interface Message {
    id: string;
    author: string;
    body: string;
    createdAt: string;
    updatedAt: string;
    url: string;
}
export interface Activity {
    id: string;
    type: "comment" | "review" | "thread";
    messages: Message[];
    path?: string;
    line?: number;
    resolved?: boolean;
    outdated?: boolean;
}
export interface Check {
    id: string;
    name: string;
    status: CI | "skip" | "cancel";
    detail: string;
    url: string;
}
export interface PRMeta {
    number: number;
    nodeId: string;
    title: string;
    author: string;
    createdAt: string;
    updatedAt: string;
    url: string;
    head: string;
    base: string;
    description: string;
    ci: CI;
    draft: boolean;
    autoMerge: boolean;
    merged: boolean;
    mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
    mergeState: string;
    additions: number;
    deletions: number;
    fileCount: number;
}
export interface PullRequest extends PRMeta {
    files: Section<FileChange[]>;
    comments: Section<Activity[]>;
    checks: Section<Check[]>;
}
export interface InboxStatus {
    repo: string;
    since: string;
    cutoff: string;
    loading: boolean;
    error?: string;
    syncedAt?: string;
    account?: string;
}
export type InboxEvent =
    | { type: "snapshot"; numbers: number[] }
    | { type: "status"; status: InboxStatus }
    | { type: "pr"; pr: PullRequest }
    | { type: "remove"; number: number };
export type Command =
    | { action: "select"; number: number }
    | { action: "retry"; number: number; section: SectionName }
    | { action: "patch"; number: number; head: string }
    | { action: "merge"; number: number; head: string }
    | {
          action: "reply";
          number: number;
          activityId: string;
          body: string;
          resolve: boolean;
      }
    | {
          action: "resolve";
          number: number;
          activityId: string;
          resolved: boolean;
      }
    | { action: "refresh" };
export interface ViewState {
    file: string;
    panel: "diff" | "comments" | "checks";
    scroll: number;
}
export interface UserState {
    selected?: number;
    views: Record<string, ViewState>;
    drafts: Record<string, string>;
}
export const emptySection = <T>(data: T): Section<T> => ({
    data,
    status: "idle",
});
export const hasConflicts = (
    pr: Pick<PRMeta, "mergeable" | "mergeState">,
): boolean => pr.mergeable === "CONFLICTING" || pr.mergeState === "DIRTY";
export const canMergeDirectly = (
    pr: Pick<PRMeta, "ci" | "mergeable" | "mergeState" | "draft">,
): boolean =>
    !pr.draft &&
    pr.ci === "pass" &&
    pr.mergeable === "MERGEABLE" &&
    !hasConflicts(pr);
export class AutoMergeCleanStatus extends Error {
    constructor(options?: ErrorOptions) {
        super("Pull request became ready to merge.", options);
    }
}
export const revision = (pr: Pick<PRMeta, "head" | "base">): string =>
    `${pr.base}:${pr.head}`;
export function makePR(meta: PRMeta): PullRequest {
    return {
        ...meta,
        files: emptySection([]),
        comments: emptySection([]),
        checks: emptySection([]),
    };
}
export function latest(activity: Activity): number {
    return Math.max(
        0,
        ...activity.messages.map((m) => Date.parse(m.updatedAt || m.createdAt)),
    );
}
export function orderActivities(items: Activity[]): Activity[] {
    return items
        .map((activity) => ({
            ...activity,
            messages: [...activity.messages].sort(
                (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
            ),
        }))
        .sort((a, b) => latest(b) - latest(a) || a.id.localeCompare(b.id));
}
export function rollup(checks: Check[]): CI {
    if (checks.some((c) => c.status === "fail" || c.status === "cancel"))
        return "fail";
    if (checks.some((c) => c.status === "pending")) return "pending";
    if (checks.length === 0 || checks.some((c) => c.status === "unknown"))
        return "unknown";
    return checks.some((c) => c.status === "pass") ? "pass" : "unknown";
}
export function parseSince(value: string, now = Date.now()): string {
    const match =
        /^(\d+(?:\.\d+)?)\s*(h(?:ours?)?|d(?:ays?)?|w(?:eeks?)?)$/i.exec(
            value.trim(),
        );
    if (!match || +match[1] <= 0)
        throw new Error(
            'Use a positive duration, e.g. --since "4 days", "12h", or "2 weeks".',
        );
    const ms =
        +match[1] *
        ({ h: 3600000, d: 86400000, w: 604800000 }[match[2][0].toLowerCase()] ??
            0);
    const result = new Date(now - ms);
    if (!Number.isFinite(result.getTime()))
        throw new Error("Duration is out of range.");
    return result.toISOString();
}
