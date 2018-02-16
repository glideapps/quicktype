"use strict";

import * as os from "os";
import * as _ from "lodash";

import { inParallel } from "./lib/multicore";
import { exec, execAsync, Sample } from "./utils";
import { Fixture, allFixtures } from "./fixtures";

const exit = require("exit");
const CPUs = parseInt(process.env.CPUs || "0", 10) || os.cpus().length;

function getChangedFiles(base: string, commit: string): string[] {
    let diff = exec(`git fetch -v origin ${base} && git diff --name-only origin/${base}..${commit}`)
        .stdout;
    return diff.trim().split("\n");
}

function buildKiteAffectedFixtures(changedFiles: string[] | undefined = undefined): Fixture[] {
    if (changedFiles === undefined) {
        const { BUILDKITE_PULL_REQUEST_BASE_BRANCH: base, BUILDKITE_COMMIT: commit } = process.env;
        return commit === undefined
            ? allFixtures
            : buildKiteAffectedFixtures(getChangedFiles(base || "master", commit));
    }

    // We can ignore changes in Markdown files
    changedFiles = _.reject(changedFiles, file => _.endsWith(file, ".md"));

    // All fixtures are dirty if any changed file is not included as a sourceFile of some fixture.
    const fileDependencies = _.flatMap(allFixtures, f => f.language.sourceFiles || []);
    const allFixturesDirty = _.some(changedFiles, f => !_.includes(fileDependencies, f));

    if (allFixturesDirty) return allFixtures;

    const dirtyFixtures = allFixtures.filter(
        fixture =>
            // Fixtures that don't specify dependencies are always dirty
            fixture.language.sourceFiles === undefined ||
            // Fixtures which have a changed file are dirty
            _.some(changedFiles, f => _.includes(fixture.language.sourceFiles, f))
    );

    return dirtyFixtures;
}

//////////////////////////////////////
// Test driver
/////////////////////////////////////

type WorkItem = { sample: Sample; fixtureName: string };

async function main(sources: string[]) {
    let fixtures = allFixtures;
    const fixturesFromCmdline = process.env.FIXTURE;
    if (fixturesFromCmdline) {
        const fixtureNames = fixturesFromCmdline.split(",");
        fixtures = _.filter(fixtures, fixture =>
            _.some(fixtureNames, name => fixture.runForName(name))
        );
    } else {
        fixtures = buildKiteAffectedFixtures();
        if (allFixtures.length !== fixtures.length) {
            console.error(
                `* Running a subset of fixtures: ${fixtures.map(f => f.name).join(", ")}`
            );
        }
    }
    // Get an array of all { sample, fixtureName } objects we'll run.
    // We can't just put the fixture in there because these WorkItems
    // will be sent in a message, removing all code.
    const samples = _.map(fixtures, fixture => ({
        fixtureName: fixture.name,
        samples: fixture.getSamples(sources)
    }));
    const priority = _.flatMap(samples, x =>
        _.map(x.samples.priority, s => ({
            fixtureName: x.fixtureName,
            sample: s
        }))
    );
    const others = _.flatMap(samples, x =>
        _.map(x.samples.others, s => ({
            fixtureName: x.fixtureName,
            sample: s
        }))
    );

    const tests = _.concat(_.shuffle(priority), _.shuffle(others));

    await inParallel({
        queue: tests,
        workers: CPUs,

        setup: async () => {
            testCLI();

            console.error(`* Running ${tests.length} tests between ${fixtures.length} fixtures`);

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
        }
    });
}

function testCLI() {
    console.log(`* CLI sanity check`);
    const qt = args => exec(`node dist/cli.js ${args}`);

    console.log("* Ensure we can quicktype a URL");
    qt(`https://blockchain.info/latestblock`);
}

// skip 2 `node` args
main(process.argv.slice(2)).catch(reason => {
    console.error(reason);
    process.exit(1);
});
