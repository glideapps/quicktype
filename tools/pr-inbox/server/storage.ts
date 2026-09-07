import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PullRequest, UserState } from "../model";
export class Storage {
    private writes = Promise.resolve();
    constructor(
        private readonly cacheDir: string,
        private readonly stateDir: string,
    ) {}
    async initialize(): Promise<void> {
        await Promise.all([
            mkdir(this.cacheDir, { recursive: true, mode: 0o700 }),
            mkdir(this.stateDir, { recursive: true, mode: 0o700 }),
        ]);
    }
    private async read<T>(path: string, fallback: T): Promise<T> {
        try {
            return JSON.parse(await readFile(path, "utf8")) as T;
        } catch (error) {
            if (
                (error as NodeJS.ErrnoException).code === "ENOENT" ||
                error instanceof SyntaxError
            )
                return fallback;
            throw error;
        }
    }
    load(): Promise<PullRequest[]> {
        return this.read(join(this.cacheDir, "v1-inbox.json"), []);
    }
    loadState(): Promise<UserState> {
        return this.read(join(this.stateDir, "state.json"), {
            views: {},
            drafts: {},
        });
    }
    private write(path: string, value: unknown): Promise<void> {
        const body = JSON.stringify(value);
        const operation = this.writes
            .catch(() => {})
            .then(async () => {
                const temporary = `${path}.${process.pid}.tmp`;
                await writeFile(temporary, body, { mode: 0o600 });
                await rename(temporary, path);
            });
        this.writes = operation;
        return operation;
    }
    save(prs: PullRequest[]): Promise<void> {
        return this.write(join(this.cacheDir, "v1-inbox.json"), prs);
    }
    saveState(state: UserState): Promise<void> {
        return this.write(join(this.stateDir, "state.json"), state);
    }
    flush(): Promise<void> {
        return this.writes;
    }
}
