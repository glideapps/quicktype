import * as _ from "lodash";
import { exec } from "shelljs";

import { WorkItem } from "./test";
import { allFixtures, Fixture } from "./fixtures";

function getChangedFiles(base: string, commit: string): string[] {
    let diff = exec(
        `git fetch -v origin ${base} && git diff --name-only origin/${base}..${commit}`,
    ).stdout;
    return diff.trim().split("\n");
}

export function affectedFixtures(
    changedFiles: string[] | undefined = undefined,
): Fixture[] {
    if (changedFiles === undefined) {
        const { GITHUB_BASE_REF: base, GITHUB_SHA: commit } = process.env;
        return commit === undefined
            ? allFixtures
            : affectedFixtures(getChangedFiles(base || "master", commit));
    }

    // We can ignore changes in Markdown files
    changedFiles = _.reject(changedFiles, (file) => _.endsWith(file, ".md"));

    // All fixtures are dirty if any changed file is not included as a sourceFile of some fixture.
    const fileDependencies = _.flatMap(
        allFixtures,
        (f) => f.language.sourceFiles || [],
    );
    const allFixturesDirty = _.some(
        changedFiles,
        (f) => !_.includes(fileDependencies, f),
    );

    if (allFixturesDirty) return allFixtures;

    const dirtyFixtures = allFixtures.filter(
        (fixture) =>
            // Fixtures that don't specify dependencies are always dirty
            fixture.language.sourceFiles === undefined ||
            // Fixtures that have a changed file are dirty
            _.some(changedFiles, (f) =>
                _.includes(fixture.language.sourceFiles, f),
            ),
    );

    return dirtyFixtures;
}

export function divideParallelJobs(workItems: WorkItem[]): WorkItem[] {
    const {
        BUILDKITE_PARALLEL_JOB: pjob,
        BUILDKITE_PARALLEL_JOB_COUNT: pcount,
    } = process.env;

    if (pjob === undefined || pcount === undefined) return workItems;

    try {
        const segment = Math.ceil(workItems.length / parseFloat(pcount));
        const start = parseInt(pjob, 10) * segment;
        return workItems.slice(start, start + segment);
    } catch {
        return workItems;
    }
}
