import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import type { Command, SectionName, UserState } from "../model";
import type { InboxService } from "./service";
import { errorMessage } from "./service";
export interface Asset {
    body: string | Uint8Array;
    type: string;
}
async function jsonBody(req: IncomingMessage): Promise<unknown> {
    let body = "";
    for await (const chunk of req) {
        body += String(chunk);
        if (Buffer.byteLength(body) > 1024 * 1024)
            throw new Error("Request is too large.");
    }
    return JSON.parse(body);
}
function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function parseCommand(value: unknown): Command {
    if (!isObject(value)) throw new Error("Invalid command.");
    if (value.action === "refresh") return { action: "refresh" };
    if (!Number.isSafeInteger(value.number) || Number(value.number) <= 0)
        throw new Error("Invalid PR number.");
    const number = Number(value.number);
    if (value.action === "select") return { action: "select", number };
    if (
        value.action === "retry" &&
        ["files", "comments", "checks"].includes(String(value.section))
    )
        return {
            action: "retry",
            number,
            section: value.section as SectionName,
        };
    if (
        (value.action === "merge" || value.action === "patch") &&
        typeof value.head === "string" &&
        /^[a-f0-9]{40}$/.test(value.head)
    )
        return { action: value.action, number, head: value.head };
    if (
        value.action === "reply" &&
        typeof value.activityId === "string" &&
        typeof value.body === "string" &&
        typeof value.resolve === "boolean"
    )
        return {
            action: "reply",
            number,
            activityId: value.activityId,
            body: value.body,
            resolve: value.resolve,
        };
    if (
        value.action === "resolve" &&
        typeof value.activityId === "string" &&
        typeof value.resolved === "boolean"
    )
        return {
            action: "resolve",
            number,
            activityId: value.activityId,
            resolved: value.resolved,
        };
    throw new Error("Invalid command.");
}
export function parseState(value: unknown): UserState {
    if (!isObject(value) || !isObject(value.views) || !isObject(value.drafts))
        throw new Error("Invalid reading state.");
    const state: UserState = { views: {}, drafts: {} };
    if (Number.isSafeInteger(value.selected))
        state.selected = Number(value.selected);
    for (const [id, view] of Object.entries(value.views)) {
        if (
            !/^\d+$/.test(id) ||
            !isObject(view) ||
            typeof view.file !== "string" ||
            !["diff", "comments", "checks"].includes(String(view.panel)) ||
            typeof view.scroll !== "number" ||
            !Number.isFinite(view.scroll)
        )
            continue;
        state.views[id] = {
            file: view.file.slice(0, 2000),
            panel: view.panel as "diff" | "comments" | "checks",
            scroll: Math.max(0, view.scroll),
        };
    }
    for (const [id, draft] of Object.entries(value.drafts))
        if (
            id.length < 300 &&
            typeof draft === "string" &&
            draft.length <= 65000
        )
            state.drafts[id] = draft;
    return state;
}
export function createInboxServer(
    service: InboxService,
    assets: Map<string, Asset>,
) {
    const token = randomBytes(32).toString("hex");
    const streams = new Set<ServerResponse>();
    const server = createServer((req, res) => {
        const address = server.address();
        const host =
            typeof address === "object" && address
                ? `127.0.0.1:${address.port}`
                : "";
        const origin = `http://${host}`;
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        );
        res.setHeader("Cache-Control", "no-store");
        if (
            req.headers.host !== host ||
            (req.headers.origin && req.headers.origin !== origin) ||
            req.headers["sec-fetch-site"] === "cross-site"
        ) {
            res.writeHead(403).end("Forbidden");
            return;
        }
        const url = new URL(req.url ?? "/", origin);
        const reply = (status: number, body: unknown) => {
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(body));
        };
        void (async () => {
            if (req.method === "GET" && url.pathname === "/api/bootstrap") {
                reply(200, {
                    token,
                    status: service.status,
                    state: await service.loadState(),
                });
                return;
            }
            if (
                url.pathname.startsWith("/api/") &&
                (req.method === "POST"
                    ? req.headers["x-inbox-token"] !== token
                    : url.searchParams.get("token") !== token)
            ) {
                reply(403, { error: "Invalid session." });
                return;
            }
            if (req.method === "GET" && url.pathname === "/api/events") {
                res.writeHead(200, {
                    "Content-Type": "text/event-stream",
                    Connection: "keep-alive",
                });
                streams.add(res);
                const unsubscribe = service.subscribe((event) => {
                    if (res.writableLength > 16 * 1024 * 1024) {
                        res.destroy();
                        return;
                    }
                    res.write(`data: ${JSON.stringify(event)}\n\n`);
                });
                const heartbeat = setInterval(
                    () => res.write(": heartbeat\n\n"),
                    15000,
                );
                req.on("close", () => {
                    unsubscribe();
                    clearInterval(heartbeat);
                    streams.delete(res);
                });
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/command") {
                reply(
                    200,
                    await service.command(parseCommand(await jsonBody(req))),
                );
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/state") {
                await service.saveState(parseState(await jsonBody(req)));
                reply(200, {});
                return;
            }
            if (req.method === "GET") {
                const asset = assets.get(url.pathname);
                if (asset) {
                    res.writeHead(200, { "Content-Type": asset.type });
                    res.end(asset.body);
                    return;
                }
            }
            reply(404, { error: "Not found." });
        })().catch((error) => reply(400, { error: errorMessage(error) }));
    });
    return {
        server,
        stopStreams: () => {
            for (const stream of streams) stream.end();
        },
    };
}
