import * as cluster from "cluster";
import * as process from "process";

const exit = require('exit');
const _ = require("lodash");

const WORKERS = ["👷🏻", "👷🏼", "👷🏽", "👷🏾", "👷🏿"];

export interface ParallelArgs<T> {
    queue: T[]
    workers: number;
    setup?: () => void;
    work: (item: T, index: number) => void;
}

function guys(n: number): string {
    return _.range(n).map((i) => WORKERS[i % WORKERS.length]).join();
}

export function inParallel<T>({ queue, workers, setup, work }: ParallelArgs<T>) {
    let items = queue.map((item, i) => {
        return { item, i };
    });
    let total = queue.length;

    if (cluster.isMaster) {
        setup && setup();

        cluster.on("message", (worker) => {
            if (items.length) {
                worker.send(items.shift());
            } else {
                worker.kill();
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

        // master sends a { fixtureName, sample } to run
        process.on('message', ({ item, i }) => {
            work(item, i);
            process.send("ready");
        });

        // Ask master for work
        process.send("ready");
    }
}