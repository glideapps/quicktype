import * as cluster from "cluster";
import * as process from "process";
import * as _ from "lodash";

const exit = require('exit');

const WORKERS = ["👷🏻", "👷🏼", "👷🏽", "👷🏾", "👷🏿"];

export interface ParallelArgs<Item, Result, Acc> {
    queue: Item[]
    workers: number;
    setup(): Acc;
    map(item: Item, index: number): Result;
    reduce?(result: Result, accum: Acc): Acc;
    done?(accum: Acc);
}

function guys(n: number): string {
    return _.range(n).map((i) => WORKERS[i % WORKERS.length]).join(' ');
}

export function inParallel<Item, Result, Acc>(args: ParallelArgs<Item, Result, Acc>) {
    let { queue } = args;
    let total = queue.length;
    let items = queue.map((item, i) => {
        return { item, i };
    });

    if (cluster.isMaster) {
        let { setup, reduce, workers, done } = args;
        let accumulator = setup();

        cluster.on("message", (worker, { result }) => {
            result && reduce && reduce(result, accumulator);

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
        _.range(workers).forEach((i) => cluster.fork({ worker: i }));
        
    } else {
        // Setup a worker
        let { map } = args;

        // master sends a { fixtureName, sample } to run
        process.on('message', ({ item, i }) => {
            process.send({
                result: map(item, i)
            });
        });

        // Ask master for work
        process.send("ready");
    }
}