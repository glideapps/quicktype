import * as os from "node:os";

import { inParallel } from "./lib/multicore";
import { execAsync, type Sample } from "./utils";
import { allFixtures } from "./fixtures";
import { affectedFixtures, divideParallelJobs } from "./buildkite";

const exit = require("exit");
const CPUs = Number.parseInt(process.env.CPUs || "0", 10) || os.cpus().length;

//////////////////////////////////////
// Test driver
/////////////////////////////////////

export type WorkItem = { sample: Sample; fixtureName: string };

async function main(sources: string[]) {
    let fixtures = affectedFixtures();
    const fixturesFromCmdline = process.env.FIXTURE;
    if (fixturesFromCmdline) {
        const fixtureNames = fixturesFromCmdline.split(",");
        fixtures = fixtures.filter((fixture) =>
            fixtureNames.some(fixture.runForName),
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
    const samples = fixtures.map((fixture) => ({
        fixtureName: fixture.name,
        samples: fixture.getSamples(sources),
    }));
    const priority = samples.flatMap((sample) =>
        sample.samples.priority.map((prioritySample) => ({
            fixtureName: sample.fixtureName,
            sample: prioritySample,
        })),
    );
    const others = samples.flatMap((sample) =>
        sample.samples.others.map((otherSample) => ({
            fixtureName: sample.fixtureName,
            sample: otherSample,
        })),
    );

    const tests = divideParallelJobs(priority.concat(others));

    await inParallel({
        queue: tests,
        workers: CPUs,

        setup: async () => {
            console.error(
                `* Running ${tests.length} tests between ${fixtures.length} fixtures`,
            );

            for (const fixture of fixtures) {
                await execAsync("rm -rf test/runs");
                await execAsync("mkdir -p test/runs");

                await fixture.setup();
            }
        },

        map: async ({ sample, fixtureName }: WorkItem, index) => {
            const fixture = fixtures.find(({ name }) => name === fixtureName);

            try {
                await fixture?.runWithSample(sample, index, tests.length);
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
