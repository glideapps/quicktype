import * as cluster from "cluster";
import * as process from "process";
import * as _ from "lodash";

const exit = require('exit');

const WORKERS = ["👷🏻", "👷🏼", "👷🏽", "👷🏾", "👷🏿"];

export interface ParallelArgs<Item, Result, Acc> {
    queue: Item[]
    workers: number;
    setup(): Promise<Acc>;
    map(item: Item, index: number): Promise<Result>;
    reduce?(accum: Acc, result: Result, item: Item): Promise<Acc>;
    done?(accum: Acc);
}

function randomPick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function guys(n: number): string {
    return _.range(n).map((i) => randomPick(WORKERS)).join(' ');
}

export async function inParallel<Item, Result, Acc>(args: ParallelArgs<Item, Result, Acc>) {
    let { queue } = args;
    let total = queue.length;
    let items = queue.map((item, i) => {
        return { item, i };
    });

    if (cluster.isMaster) {
        let { setup, reduce, workers, done, map } = args;
        let accumulator = await setup();

        cluster.on("message", (worker, { result, item }) => {
            result && reduce && reduce(accumulator, result, item);

            if (items.length) {
                worker.send(items.shift());
            } else {
                worker.kill();
                
                if (_.isEmpty(cluster.workers)) {
                    done && done(accumulator);
                }
            }
        });

        cluster.on("exit", (worker, code, signal) => {
            if (code && code !== 0) {
                // Kill workers and exit if any worker dies
                _.forIn(cluster.workers, (w) => w.kill());
                exit(code);
            }
        });

        console.error(`* Forking ${workers} workers ${guys(workers)}`);
        if (workers < 2) {
            // We run everything on the master process if only one worker
            for (let { item, i } of items) {
                let result = await map(item, i);
                accumulator = await reduce(accumulator, result, item);
            }
            return done && done(accumulator);
        } else {
            _.range(workers).forEach((i) => cluster.fork({
                worker: i,
                // https://github.com/TypeStrong/ts-node/issues/367
                TS_NODE_PROJECT: "test/tsconfig.json"
            }));
        }
    } else {
        // Setup a worker
        let { map } = args;

        // master sends a { fixtureName, sample } to run
        process.on('message', async ({ item, i }) => {
            process.send({
                result: await map(item, i)
            });
        });

        // Ask master for work
        process.send("ready");
    }
}