import * as os from "os";
import * as _ from "lodash";

import { inParallel } from "./lib/multicore";
import { execAsync, Sample } from "./utils";
import { Fixture, allFixtures } from "./fixtures";
import { affectedFixtures, divideParallelJobs } from "./buildkite";

const exit = require("exit");
const CPUs = parseInt(process.env.CPUs || "0", 10) || os.cpus().length;

//////////////////////////////////////
// Test driver
/////////////////////////////////////

export type WorkItem = { sample: Sample; fixtureName: string };

async function main(sources: string[]) {
    let fixtures = affectedFixtures();
    const fixturesFromCmdline = process.env.FIXTURE;
    if (fixturesFromCmdline) {
        const fixtureNames = fixturesFromCmdline.split(",");
        fixtures = _.filter(fixtures, (fixture) =>
            _.some(fixtureNames, (name) => fixture.runForName(name)),
        );
    }

    if (allFixtures.length !== fixtures.length) {
        console.error(
            `* Running a subset of fixtures: ${fixtures.map((f) => f.name).join(", ")}`,
        );
    }

    // Get an array of all { sample, fixtureName } objects we'll run.
    // We can't just put the fixture in there because these WorkItems
    // will be sent in a message, removing all code.
    const samples = _.map(fixtures, (fixture) => ({
        fixtureName: fixture.name,
        samples: fixture.getSamples(sources),
    }));
    const priority = _.flatMap(samples, (x) =>
        _.map(x.samples.priority, (s) => ({
            fixtureName: x.fixtureName,
            sample: s,
        })),
    );
    const others = _.flatMap(samples, (x) =>
        _.map(x.samples.others, (s) => ({
            fixtureName: x.fixtureName,
            sample: s,
        })),
    );

    const tests = divideParallelJobs(_.concat(priority, others));

    await inParallel({
        queue: tests,
        workers: CPUs,

        setup: async () => {
            console.error(
                `* Running ${tests.length} tests between ${fixtures.length} fixtures`,
            );

            for (const fixture of fixtures) {
                await execAsync(`rm -rf test/runs`);
                await execAsync(`mkdir -p test/runs`);

                await fixture.setup();
            }
        },

        map: async ({ sample, fixtureName }: WorkItem, index) => {
            let fixture = _.find(fixtures, { name: fixtureName }) as Fixture;
            try {
                await fixture.runWithSample(sample, index, tests.length);
            } catch (e) {
                console.trace(e);
                exit(1);
            }
        },
    });
}

// skip 2 `node` args
main(process.argv.slice(2)).catch((reason) => {
    console.error(reason);
    process.exit(1);
});
