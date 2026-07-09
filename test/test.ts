import cluster from "node:cluster";

import * as os from "os";
import * as _ from "lodash";

import { inParallel } from "./lib/multicore";
import { execAsync, type Sample } from "./utils";
import { type Fixture, allFixtures } from "./fixtures";
import { affectedFixtures, divideParallelJobs } from "./buildkite";
import { checkCoreImportKeepsStdoutClean } from "./check-clean-import";
import { checkJavaEnumAcronymCasing } from "./check-java-acronym-names";
import { checkCoreHasNoNodePrefixedImports } from "./check-no-node-imports";
import { checkURLInput } from "./check-url-input";

const exit = require("exit");
const CPUs = Number.parseInt(process.env.CPUs || "0", 10) || os.cpus().length;

//////////////////////////////////////
// Test driver
/////////////////////////////////////

export type WorkItem = { sample: Sample; fixtureName: string };

async function main(sources: string[]) {
    // Cheap sanity check, run before any fixture: quicktype-core must not
    // use "node:"-prefixed imports or it breaks web bundlers (issue #2763).
    checkCoreHasNoNodePrefixedImports();

    // Regression check for issue #2874: importing the built quicktype-core
    // must not write to stdout — CI builds used to swap in a fetch shim that
    // printed a banner on import, corrupting redirected CLI output.
    checkCoreImportKeepsStdoutClean();

    // Regression check for issue #2850: Java enum constants must keep
    // acronyms uppercase for every --acronym-style. The fixture harness
    // can't catch this (mangled constants still compile and round-trip).
    await checkJavaEnumAcronymCasing();

    // Regression check for issues #2613, #2678, #2821: URL inputs must work
    // with the native (WHATWG) fetch on Node >= 18. The fixture harness only
    // uses local files, so it can't catch this. Only run it in the cluster
    // primary: forked workers re-execute main() too, and in a cluster worker
    // `server.listen(0)` gives every worker the *same* shared port, with
    // connections round-robined between them — concurrent workers cross-talk
    // and hit each others' closing servers.
    if (cluster.isPrimary) {
        await checkURLInput();
    }

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
            const fixture = _.find(fixtures, { name: fixtureName }) as Fixture;
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
