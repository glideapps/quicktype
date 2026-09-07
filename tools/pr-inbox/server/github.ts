import { AutoMergeCleanStatus, canMergeDirectly } from "../model";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type {
    Activity,
    Check,
    CI,
    FileChange,
    Message,
    PRMeta,
} from "../model";
const exec = promisify(execFile);
interface Connection<T> {
    nodes: T[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
}
interface Author {
    login: string;
}
interface GMessage {
    id: string;
    body: string;
    author: Author | null;
    createdAt: string;
    updatedAt: string;
    url: string;
}
interface GThread {
    id: string;
    isResolved: boolean;
    isOutdated: boolean;
    path: string;
    line: number | null;
    originalLine: number | null;
    comments: Connection<GMessage>;
}
interface GPR {
    id: string;
    number: number;
    title: string;
    body: string;
    author: Author | null;
    createdAt: string;
    updatedAt: string;
    url: string;
    headRefOid: string;
    baseRefOid: string;
    isDraft: boolean;
    merged: boolean;
    autoMergeRequest: unknown;
    mergeable: PRMeta["mergeable"];
    mergeStateStatus: string;
    additions: number;
    deletions: number;
    changedFiles: number;
    commits: {
        nodes: { commit: { statusCheckRollup: { state: string } | null } }[];
    };
}
interface RESTComment {
    id: number;
    body: string;
    user: Author | null;
    created_at?: string;
    updated_at?: string;
    submitted_at?: string;
    html_url: string;
}
interface RESTFile {
    filename: string;
    previous_filename?: string;
    additions: number;
    deletions: number;
    patch?: string;
    blob_url: string;
}
interface RESTCheck {
    id: number;
    name: string;
    app: { id: number };
    status: string;
    conclusion: string | null;
    html_url: string;
    details_url: string;
    output: { summary?: string };
}
interface RESTStatus {
    id: number;
    context: string;
    state: string;
    description: string;
    target_url: string;
}
export interface Page<T> {
    items: T[];
    next?: string;
}
export interface Provider {
    list: (cursor?: string) => Promise<Page<PRMeta>>;
    meta: (number: number) => Promise<PRMeta>;
    files: (number: number, page?: string) => Promise<Page<FileChange>>;
    comments: (
        number: number,
        kind: "comments" | "reviews",
        page?: string,
    ) => Promise<Page<Activity>>;
    threads: (
        number: number,
        cursor?: string,
    ) => Promise<Page<Activity & { nextReply?: string }>>;
    replies: (id: string, cursor: string) => Promise<Page<Message>>;
    checks: (head: string, page?: string) => Promise<Page<Check>>;
    statuses: (head: string, page?: string) => Promise<Page<Check>>;
    fullDiff: (number: number) => Promise<string>;
    merge: (pr: PRMeta, method: MergeMethod) => Promise<string>;
    reply: (
        number: number,
        activity: Activity | undefined,
        body: string,
    ) => Promise<void>;
    resolve: (id: string, resolved: boolean) => Promise<void>;
}
export type MergeMethod = "squash" | "merge" | "rebase";
const fields =
    "id number title body author{login} createdAt updatedAt url headRefOid baseRefOid isDraft merged autoMergeRequest{enabledAt} mergeable mergeStateStatus additions deletions changedFiles commits(last:1){nodes{commit{statusCheckRollup{state}}}}";
const pageInfo = "pageInfo{hasNextPage endCursor}";
const messageFields = "id body author{login} createdAt updatedAt url";
function ci(state?: string): CI {
    return state === "SUCCESS"
        ? "pass"
        : state === "FAILURE" || state === "ERROR"
          ? "fail"
          : state === "PENDING" || state === "EXPECTED"
            ? "pending"
            : "unknown";
}
function meta(pr: GPR): PRMeta {
    return {
        number: pr.number,
        nodeId: pr.id,
        title: pr.title,
        description: pr.body,
        author: pr.author?.login ?? "deleted",
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        url: pr.url,
        head: pr.headRefOid,
        base: pr.baseRefOid,
        draft: pr.isDraft,
        autoMerge: !!pr.autoMergeRequest,
        merged: pr.merged,
        mergeable: pr.mergeable,
        mergeState: pr.mergeStateStatus,
        ci: ci(pr.commits.nodes[0]?.commit.statusCheckRollup?.state),
        additions: pr.additions,
        deletions: pr.deletions,
        fileCount: pr.changedFiles,
    };
}
function connection<T, U>(
    result: Connection<T>,
    convert: (item: T) => U,
): Page<U> {
    return {
        items: result.nodes.map(convert),
        next: result.pageInfo.hasNextPage
            ? (result.pageInfo.endCursor ?? undefined)
            : undefined,
    };
}
const message = (m: GMessage): Message => ({
    ...m,
    author: m.author?.login ?? "deleted",
});
export class GitHub implements Provider {
    private readonly cached = new Map<
        string,
        { etag: string; body: unknown; next?: string }
    >();
    private blockedUntil = 0;
    readonly owner: string;
    readonly name: string;
    constructor(
        readonly repo: string,
        private readonly token: string,
    ) {
        [this.owner, this.name] = repo.split("/");
    }
    static async authenticate(
        repo: string,
    ): Promise<{ provider: GitHub; identity: string }> {
        const { stdout } = await exec(
            "gh",
            ["auth", "token", "--hostname", "github.com"],
            { timeout: 15000 },
        );
        const token = stdout.trim();
        if (!token) throw new Error("Run gh auth login first.");
        return {
            provider: new GitHub(repo, token),
            identity: createHash("sha256")
                .update(token)
                .digest("hex")
                .slice(0, 20),
        };
    }
    private async request<T>(
        path: string,
        method = "GET",
        body?: unknown,
        diff = false,
    ): Promise<{ data: T; next?: string }> {
        const readable =
            method === "GET" ||
            (path === "/graphql" &&
                !String((body as { query?: string })?.query)
                    .trim()
                    .startsWith("mutation"));
        for (let attempt = 0; ; attempt++) {
            const delay = this.blockedUntil - Date.now();
            if (delay > 0)
                await new Promise((resolve) => setTimeout(resolve, delay));
            const cached =
                method === "GET" && !diff ? this.cached.get(path) : undefined;
            const headers: Record<string, string> = {
                Authorization: `Bearer ${this.token}`,
                Accept: diff
                    ? "application/vnd.github.diff"
                    : "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            };
            if (cached) headers["If-None-Match"] = cached.etag;
            if (body) headers["Content-Type"] = "application/json";
            let response: Response;
            try {
                response = await fetch(`https://api.github.com${path}`, {
                    method,
                    headers,
                    body: body ? JSON.stringify(body) : undefined,
                    signal: AbortSignal.timeout(45000),
                });
            } catch (error) {
                if (readable && attempt < 2) continue;
                throw new Error(
                    "GitHub request failed. Check your connection.",
                    { cause: error },
                );
            }
            const link = response.headers
                .get("link")
                ?.match(/<https:\/\/api\.github\.com([^>]+)>; rel="next"/)?.[1];
            if (response.status === 304 && cached)
                return { data: cached.body as T, next: cached.next };
            const text = await response.text();
            if (!response.ok) {
                const rateLimited =
                    response.status === 429 ||
                    (response.status === 403 &&
                        /rate limit|secondary rate/i.test(text));
                if (rateLimited) {
                    const retry =
                        Number(response.headers.get("retry-after")) || 60;
                    const reset =
                        response.headers.get("x-ratelimit-remaining") === "0"
                            ? Number(
                                  response.headers.get("x-ratelimit-reset"),
                              ) *
                                  1000 -
                              Date.now()
                            : 0;
                    this.blockedUntil =
                        Date.now() + Math.max(retry * 1000, reset);
                }
                if (
                    readable &&
                    attempt < 2 &&
                    (rateLimited || response.status >= 500)
                ) {
                    if (!rateLimited)
                        await new Promise((resolve) =>
                            setTimeout(resolve, 1000 * (attempt + 1)),
                        );
                    continue;
                }
                let detail = text.slice(0, 400);
                try {
                    detail = JSON.parse(text).message ?? detail;
                } catch {}
                throw new Error(`GitHub ${response.status}: ${detail}`);
            }
            const data = (diff ? text : JSON.parse(text)) as T;
            const etag = response.headers.get("etag");
            if (etag && method === "GET" && !diff) {
                if (this.cached.size >= 500)
                    this.cached.delete(this.cached.keys().next().value ?? "");
                this.cached.set(path, { etag, body: data, next: link });
            }
            return { data, next: link };
        }
    }
    private async graphql<T>(
        query: string,
        variables: Record<string, unknown>,
    ): Promise<T> {
        const result = await this.request<{
            data: T;
            errors?: { message: string }[];
        }>("/graphql", "POST", { query, variables });
        if (result.data.errors && result.data.errors.length > 0)
            throw new Error(
                result.data.errors.map((e) => e.message).join("; "),
            );
        return result.data.data;
    }
    async list(cursor?: string): Promise<Page<PRMeta>> {
        const result = await this.graphql<{
            repository: { pullRequests: Connection<GPR> } | null;
        }>(
            `query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){pullRequests(first:30,after:$cursor,states:OPEN,orderBy:{field:CREATED_AT,direction:DESC}){${pageInfo} nodes{${fields}}}}}`,
            { owner: this.owner, name: this.name, cursor },
        );
        if (!result.repository)
            throw new Error(`Repository ${this.repo} is unavailable.`);
        return connection(result.repository.pullRequests, meta);
    }
    async meta(number: number): Promise<PRMeta> {
        const result = await this.graphql<{ repository: { pullRequest: GPR } }>(
            `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){${fields}}}}`,
            { owner: this.owner, name: this.name, number },
        );
        return meta(result.repository.pullRequest);
    }
    async files(number: number, page?: string): Promise<Page<FileChange>> {
        const result = await this.request<RESTFile[]>(
            page ?? `/repos/${this.repo}/pulls/${number}/files?per_page=30`,
        );
        return {
            items: result.data.map((f) => ({
                path: f.filename,
                previousPath: f.previous_filename,
                additions: f.additions,
                deletions: f.deletions,
                patch: f.patch,
                url: f.blob_url,
            })),
            next: result.next,
        };
    }
    async comments(
        number: number,
        kind: "comments" | "reviews",
        page?: string,
    ): Promise<Page<Activity>> {
        const path =
            kind === "comments"
                ? `issues/${number}/comments`
                : `pulls/${number}/reviews`;
        const result = await this.request<RESTComment[]>(
            page ?? `/repos/${this.repo}/${path}?per_page=100`,
        );
        return {
            next: result.next,
            items: result.data
                .filter((m) => m.body)
                .map((m) => ({
                    id: `${kind}:${m.id}`,
                    type: kind === "comments" ? "comment" : "review",
                    messages: [
                        {
                            id: String(m.id),
                            author: m.user?.login ?? "deleted",
                            body: m.body,
                            createdAt: m.created_at ?? m.submitted_at ?? "",
                            updatedAt: m.updated_at ?? m.submitted_at ?? "",
                            url: m.html_url,
                        },
                    ],
                })),
        };
    }
    async threads(
        number: number,
        cursor?: string,
    ): Promise<Page<Activity & { nextReply?: string }>> {
        const result = await this.graphql<{
            repository: { pullRequest: { reviewThreads: Connection<GThread> } };
        }>(
            `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:50,after:$cursor){${pageInfo} nodes{id isResolved isOutdated path line originalLine comments(first:100){${pageInfo} nodes{${messageFields}}}}}}}}`,
            { owner: this.owner, name: this.name, number, cursor },
        );
        return connection(result.repository.pullRequest.reviewThreads, (t) => ({
            id: t.id,
            type: "thread",
            path: t.path,
            line: t.line ?? t.originalLine ?? undefined,
            resolved: t.isResolved,
            outdated: t.isOutdated,
            messages: t.comments.nodes.map(message),
            nextReply: t.comments.pageInfo.hasNextPage
                ? (t.comments.pageInfo.endCursor ?? undefined)
                : undefined,
        }));
    }
    async replies(id: string, cursor: string): Promise<Page<Message>> {
        const result = await this.graphql<{
            node: { comments: Connection<GMessage> };
        }>(
            `query($id:ID!,$cursor:String!){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$cursor){${pageInfo} nodes{${messageFields}}}}}}`,
            { id, cursor },
        );
        return connection(result.node.comments, message);
    }
    async checks(head: string, page?: string): Promise<Page<Check>> {
        const result = await this.request<{ check_runs: RESTCheck[] }>(
            page ??
                `/repos/${this.repo}/commits/${head}/check-runs?per_page=100&filter=latest`,
        );
        return {
            next: result.next,
            items: result.data.check_runs.map((c) => ({
                id: `${c.app.id}:${c.name}`,
                name: c.name,
                status:
                    c.status !== "completed"
                        ? "pending"
                        : c.conclusion === "success"
                          ? "pass"
                          : c.conclusion === "skipped" ||
                              c.conclusion === "neutral"
                            ? "skip"
                            : c.conclusion === "cancelled"
                              ? "cancel"
                              : c.conclusion === "failure" ||
                                  c.conclusion === "timed_out" ||
                                  c.conclusion === "action_required"
                                ? "fail"
                                : "unknown",
                detail: c.output.summary ?? c.conclusion ?? c.status,
                url: c.html_url || c.details_url,
            })),
        };
    }
    async statuses(head: string, page?: string): Promise<Page<Check>> {
        const result = await this.request<RESTStatus[]>(
            page ?? `/repos/${this.repo}/commits/${head}/statuses?per_page=100`,
        );
        return {
            next: result.next,
            items: result.data.map((c) => ({
                id: `status:${c.context}`,
                name: c.context,
                status:
                    c.state === "success"
                        ? "pass"
                        : c.state === "failure" || c.state === "error"
                          ? "fail"
                          : c.state === "pending"
                            ? "pending"
                            : "unknown",
                detail: c.description ?? c.state,
                url: c.target_url ?? "",
            })),
        };
    }
    async fullDiff(number: number): Promise<string> {
        return (
            await this.request<string>(
                `/repos/${this.repo}/pulls/${number}`,
                "GET",
                undefined,
                true,
            )
        ).data;
    }
    async merge(pr: PRMeta, method: MergeMethod): Promise<string> {
        if (!canMergeDirectly(pr)) {
            try {
                await this.graphql(
                    "mutation($id:ID!,$method:PullRequestMergeMethod!,$head:GitObjectID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:$method,expectedHeadOid:$head}){pullRequest{id}}}",
                    {
                        id: pr.nodeId,
                        method: method.toUpperCase(),
                        head: pr.head,
                    },
                );
            } catch (error) {
                if (
                    error instanceof Error &&
                    /^Pull request(?: Pull request)? is in clean status$/i.test(
                        error.message,
                    )
                )
                    throw new AutoMergeCleanStatus({ cause: error });
                throw error;
            }
            return "Auto-merge enabled";
        }
        try {
            const response = await this.request<{
                merged: boolean;
                message: string;
            }>(`/repos/${this.repo}/pulls/${pr.number}/merge`, "PUT", {
                sha: pr.head,
                merge_method: method,
            });
            if (!response.data.merged)
                throw new Error(
                    response.data.message || "GitHub did not merge this PR.",
                );
            return "Merged";
        } catch (error) {
            if (
                !(error instanceof Error) ||
                !/GitHub 4\d\d:.*merge queue/i.test(error.message)
            )
                throw error;
            await this.graphql(
                "mutation($id:ID!,$head:GitObjectID!){enqueuePullRequest(input:{pullRequestId:$id,expectedHeadOid:$head}){mergeQueueEntry{id}}}",
                { id: pr.nodeId, head: pr.head },
            );
            return "Added to merge queue";
        }
    }
    async reply(
        number: number,
        activity: Activity | undefined,
        body: string,
    ): Promise<void> {
        if (activity?.type === "thread")
            await this.graphql(
                "mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id}}}",
                { id: activity.id, body },
            );
        else
            await this.request(
                `/repos/${this.repo}/issues/${number}/comments`,
                "POST",
                { body },
            );
    }
    async resolve(id: string, resolved: boolean): Promise<void> {
        await this.graphql(
            `mutation($id:ID!){${resolved ? "resolveReviewThread" : "unresolveReviewThread"}(input:{threadId:$id}){thread{id}}}`,
            { id },
        );
    }
}
