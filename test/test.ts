"use strict";

import * as os from "os";
import * as _ from "lodash";

import { inParallel } from "./lib/multicore";
import { exec } from "./utils";
import { allFixtures } from "./fixtures";

const exit = require("exit");

//////////////////////////////////////
// Constants
/////////////////////////////////////

const CPUs = +process.env.CPUs || os.cpus().length;

//////////////////////////////////////
// Test driver
/////////////////////////////////////

type WorkItem = { sample: string; fixtureName: string };

async function main(sources: string[]) {
  let fixtures = allFixtures;
  if (process.env.FIXTURE) {
    const fixtureNames = process.env.FIXTURE.split(",");
    fixtures = _.filter(fixtures, fixture =>
      _.some(fixtureNames, name => fixture.runForName(name))
    );
  }
  // Get an array of all { sample, fixtureName } objects we'll run
  const samples = _.map(fixtures, fixture => ({
    fixtureName: fixture.name,
    samples: fixture.getSamples(sources)
  }));
  const priority = _.flatMap(samples, x =>
    _.map(x.samples.priority, s => ({ fixtureName: x.fixtureName, sample: s }))
  );
  const others = _.flatMap(samples, x =>
    _.map(x.samples.others, s => ({ fixtureName: x.fixtureName, sample: s }))
  );

  const tests = _.concat(_.shuffle(priority), _.shuffle(others));

  await inParallel({
    queue: tests,
    workers: CPUs,

    setup: async () => {
      testCLI();

      console.error(
        `* Running ${tests.length} tests between ${fixtures.length} fixtures`
      );

      for (const fixture of fixtures) {
        exec(`rm -rf test/runs`);
        exec(`mkdir -p test/runs`);

        await fixture.setup();
      }
    },

    map: async ({ sample, fixtureName }: WorkItem, index) => {
      let fixture = _.find(fixtures, { name: fixtureName });
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
  const qt = "node output/quicktype.js";
  exec(`${qt} --help`);
}

// skip 2 `node` args
main(process.argv.slice(2)).catch(reason => {
  console.error(reason);
  process.exit(1);
});
