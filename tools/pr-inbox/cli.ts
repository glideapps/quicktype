import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { parseSince } from "./model";
import { GitHub, type MergeMethod } from "./server/github";
import { Gateway } from "./server/gateway";
import { Storage } from "./server/storage";
import { InboxService } from "./server/service";
import { createInboxServer, type Asset } from "./server/http";
async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            since: { type: "string", default: "4 days" },
            repo: { type: "string", default: "glideapps/quicktype" },
            port: { type: "string", default: "0" },
            "no-open": { type: "boolean" },
            "merge-method": { type: "string", default: "squash" },
            help: { type: "boolean", short: "h" },
        },
    });
    if (values.help) {
        console.log(
            'Usage: npm run prs -- --since "4 days" [--repo owner/name] [--port 0] [--no-open] [--merge-method squash|merge|rebase]',
        );
        return;
    }
    const cutoff = parseSince(values.since);
    if (
        !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(values.repo) ||
        [".", ".."].includes(values.repo.split("/")[1])
    )
        throw new Error("Repository must be owner/name.");
    if (!/^\d+$/.test(values.port) || +values.port > 65535)
        throw new Error("Port must be 0–65535.");
    if (!["squash", "merge", "rebase"].includes(values["merge-method"]))
        throw new Error("Merge method must be squash, merge, or rebase.");
    // biome-ignore lint/correctness/noGlobalDirnameFilename: The repository runs this CLI as CommonJS.
    const root = resolve(__dirname);
    const [auth, compiled] = await Promise.all([
        GitHub.authenticate(values.repo),
        build({
            entryPoints: [
                join(root, "web/main.ts"),
                join(root, "web/diff-worker.ts"),
            ],
            bundle: true,
            write: false,
            outdir: "out",
            platform: "browser",
            format: "esm",
            target: "es2022",
            minify: true,
        }),
    ]);
    const cacheRoot =
        process.platform === "darwin"
            ? join(homedir(), "Library/Caches")
            : (process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"));
    const dataRoot =
        process.platform === "darwin"
            ? join(homedir(), "Library/Application Support")
            : (process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"));
    const scope = join(
        "quicktype-pr-inbox",
        "github.com",
        auth.identity,
        values.repo,
    );
    const cacheDir = join(cacheRoot, scope),
        stateDir = join(dataRoot, scope);
    await mkdir(cacheDir, { recursive: true, mode: 0o700 });
    const lockPath = join(cacheDir, "session.lock");
    try {
        const existing = Number(await readFile(lockPath, "utf8"));
        try {
            process.kill(existing, 0);
            throw new Error(
                `An inbox for this account and repository is already running (PID ${existing}).`,
            );
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
            await unlink(lockPath);
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const lock = await open(lockPath, "wx", 0o600);
    await lock.writeFile(String(process.pid));
    await lock.close();
    const storage = new Storage(cacheDir, stateDir);
    await storage.initialize();
    const service = new InboxService(
        new Gateway(auth.provider, storage),
        values.repo,
        values.since,
        cutoff,
        values["merge-method"] as MergeMethod,
    );
    const assets = new Map<string, Asset>();
    for (const file of compiled.outputFiles)
        assets.set(`/${file.path.split("/").pop()}`, {
            body: file.contents,
            type: "text/javascript",
        });
    assets.set("/", {
        body: await readFile(join(root, "web/index.html")),
        type: "text/html; charset=utf-8",
    });
    assets.set("/style.css", {
        body: await readFile(join(root, "web/style.css")),
        type: "text/css",
    });
    for (const name of await readdir(join(root, "fonts")))
        if (name.endsWith(".woff2"))
            assets.set(`/fonts/${name}`, {
                body: await readFile(join(root, "fonts", name)),
                type: "font/woff2",
            });
    const { server, stopStreams } = createInboxServer(service, assets);
    let closing = false;
    const close = async () => {
        if (closing) return;
        closing = true;
        stopStreams();
        server.close();
        await service.close();
        await unlink(lockPath).catch(() => {});
        process.exit(0);
    };
    process.once("SIGINT", () => void close());
    process.once("SIGTERM", () => void close());
    server.on("error", (error) => {
        console.error(error.message);
        void unlink(lockPath).finally(() => process.exit(1));
    });
    server.listen(+values.port, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") return;
        const url = `http://127.0.0.1:${address.port}`;
        console.log(
            `PR inbox: ${url}\n${values.repo} · created since ${cutoff}\nCache: ${cacheDir}\nCtrl+C to stop.`,
        );
        void service.start();
        if (!values["no-open"])
            execFile(
                process.platform === "darwin"
                    ? "open"
                    : process.platform === "win32"
                      ? "explorer"
                      : "xdg-open",
                [url],
                (error) => {
                    if (error) console.error(`Open ${url} in your browser.`);
                },
            );
    });
}
void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
