import cluster from "node:cluster";
import process from "node:process";

const exit = require("exit");

const WORKERS = ["👷🏻", "👷🏼", "👷🏽", "👷🏾", "👷🏿"];

export interface ParallelArgs<Item, Result, Acc> {
    queue: Item[];
    workers: number;
    setup(): Promise<Acc>;
    map(item: Item, index: number): Promise<Result>;
}

function randomPick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function guys(n: number): string {
    return Array.from({ length: n })
        .map(() => randomPick(WORKERS))
        .join(" ");
}

export async function inParallel<Item, Result, Acc>(
    args: ParallelArgs<Item, Result, Acc>,
) {
    const { queue } = args;
    const items = queue.map((item, i) => {
        return { item, i };
    });

    if (cluster.isPrimary) {
        const { setup, workers, map } = args;
        await setup();

        cluster.on("message", (worker) => {
            const msg = items.pop();
            if (msg !== undefined) {
                worker.send(msg);
            } else {
                worker.kill();
            }
        });

        cluster.on("exit", (_worker, code, _signal) => {
            if (code && code !== 0) {
                // Kill workers and exit if any worker dies
                for (const w of Object.values(cluster.workers ?? {})) {
                    if (w) {
                        w.kill();
                    }
                }
                exit(code);
            }
        });

        console.error(`* Forking ${workers} workers ${guys(workers)}`);
        if (workers < 2) {
            // We run everything on the master process if only one worker
            for (const { item, i } of items) {
                await map(item, i);
            }
        } else {
            for (let i = 0; i < workers; i++) {
                cluster.fork({
                    worker: i,
                    // https://github.com/TypeStrong/ts-node/issues/367
                    TS_NODE_PROJECT: "test/tsconfig.json",
                });
            }
        }
    } else {
        // Setup a worker
        const { map } = args;

        // master sends a { fixtureName, sample } to run
        process.on("message", async ({ item, i }) => {
            process.send?.({
                result: await map(item, i),
            });
        });

        // Ask master for work
        process.send?.("ready");
    }
}
