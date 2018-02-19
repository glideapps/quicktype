import * as _ from "lodash";
import { exec } from "shelljs";

import { allFixtures, Fixture } from "../test/fixtures";

function getChangedFiles(base: string, commit: string): string[] {
  let diff = exec(
    `git fetch -v origin ${base} && git diff --name-only origin/${base}..${commit}`
  ).stdout;
  return diff.trim().split("\n");
}

export function affectedFixtures(
  changedFiles: string[] | undefined = undefined
): Fixture[] {
  if (changedFiles === undefined) {
    const {
      BUILDKITE_PULL_REQUEST_BASE_BRANCH: base,
      BUILDKITE_COMMIT: commit
    } = process.env;
    return commit === undefined
      ? allFixtures
      : affectedFixtures(getChangedFiles(base || "master", commit));
  }

  // We can ignore changes in Markdown files
  changedFiles = _.reject(changedFiles, file => _.endsWith(file, ".md"));

  // All fixtures are dirty if any changed file is not included as a sourceFile of some fixture.
  const fileDependencies = _.flatMap(
    allFixtures,
    f => f.language.sourceFiles || []
  );
  const allFixturesDirty = _.some(
    changedFiles,
    f => !_.includes(fileDependencies, f)
  );

  if (allFixturesDirty) return allFixtures;

  const dirtyFixtures = allFixtures.filter(
    fixture =>
      // Fixtures that don't specify dependencies are always dirty
      fixture.language.sourceFiles === undefined ||
      // Fixtures that have a changed file are dirty
      _.some(changedFiles, f => _.includes(fixture.language.sourceFiles, f))
  );

  return dirtyFixtures;
}

function generatePipelines() {
  const fixtures = affectedFixtures();
  if (allFixtures.length !== fixtures.length) {
    console.log(`steps:
  - command: "FIXTURE=${fixtures
    .map(f => f.name)
    .join(",")} .buildkite/build-pr.sh"
    label: "${fixtures.map(f => f.name).join(" ")}"`);
  } else {
    exec(`cat .buildkite/pipeline.yml`);
  }
}

generatePipelines();
