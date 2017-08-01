const cluster = require("cluster");
const _ = require("lodash");

function inParallel({queue, workers, setup, work }) {
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
                process.exit(code);
            }
        });

        console.error(`* Forking ${workers} workers (${workers} CPUs)`);
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

module.exports = { inParallel };