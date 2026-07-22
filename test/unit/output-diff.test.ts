import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
    compareOutputSnapshots,
    renderOutputDiffReport,
} from "../../script/output-diff";
import {
    outputSnapshotCaseDirectory,
    rendererOptionsID,
    saveOutputSnapshot,
    snapshotFileState,
} from "../outputSnapshot";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "quicktype-output-diff-"),
    );
    temporaryDirectories.push(directory);
    return directory;
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { force: true, recursive: true });
    }
});

describe("output snapshots", () => {
    test("uses stable option IDs regardless of key order", () => {
        expect(rendererOptionsID({ b: "two", a: "one" })).toBe(
            rendererOptionsID({ a: "one", b: "two" }),
        );
        expect(rendererOptionsID({})).toBe("default");
        expect(rendererOptionsID({ a: "one" })).not.toBe(
            rendererOptionsID({ a: "two" }),
        );
    });

    test("captures primary and additional generated files without fixture files", () => {
        const root = temporaryDirectory();
        const runDirectory = path.join(root, "run");
        const snapshotRoot = path.join(root, "snapshot");
        fs.mkdirSync(path.join(runDirectory, "support"), { recursive: true });
        fs.writeFileSync(path.join(runDirectory, "driver.txt"), "unchanged");
        fs.writeFileSync(path.join(runDirectory, "TopLevel.h"), "old output");
        const before = snapshotFileState(runDirectory);

        fs.writeFileSync(path.join(runDirectory, "TopLevel.h"), "new output");
        fs.writeFileSync(path.join(runDirectory, "TopLevel.c"), "extra output");
        const saved = saveOutputSnapshot({
            before,
            fixtureName: "cjson-multi-split",
            primaryOutput: "TopLevel.h",
            rendererOptions: { "source-style": "multi-source" },
            runDirectory,
            samplePath: "test/inputs/json/priority/combinations1.json",
            snapshotRoot,
        });

        expect(saved).toEqual(["TopLevel.c", "TopLevel.h"]);
        const caseDirectory = outputSnapshotCaseDirectory(
            snapshotRoot,
            "cjson-multi-split",
            "test/inputs/json/priority/combinations1.json",
            { "source-style": "multi-source" },
        );
        expect(
            fs.readFileSync(path.join(caseDirectory, "TopLevel.h"), "utf8"),
        ).toBe("new output");
        expect(fs.existsSync(path.join(caseDirectory, "driver.txt"))).toBe(
            false,
        );
    });
});

describe("generated-output comparison", () => {
    test("summarizes modified, new, and deleted files and changed lines", () => {
        const root = temporaryDirectory();
        const base = path.join(root, "base");
        const head = path.join(root, "head");
        fs.mkdirSync(base);
        fs.mkdirSync(head);
        fs.writeFileSync(path.join(base, "modified.ts"), "one\ntwo\n");
        fs.writeFileSync(path.join(head, "modified.ts"), "one\nthree\n");
        fs.writeFileSync(path.join(base, "deleted.ts"), "gone\n");
        fs.writeFileSync(path.join(head, "added.ts"), "new\nlines\n");
        fs.writeFileSync(path.join(base, "same.ts"), "same\n");
        fs.writeFileSync(path.join(head, "same.ts"), "same\n");

        const { patch, result } = compareOutputSnapshots(base, head);

        expect(result.summary).toEqual({
            added: 1,
            changedLines: 5,
            deleted: 1,
            deletions: 2,
            files: 3,
            insertions: 3,
            modified: 1,
        });
        expect(result.files).toEqual([
            {
                additions: 2,
                deletions: 0,
                path: "added.ts",
                status: "added",
            },
            {
                additions: 0,
                deletions: 1,
                path: "deleted.ts",
                status: "deleted",
            },
            {
                additions: 1,
                deletions: 1,
                path: "modified.ts",
                status: "modified",
            },
        ]);
        expect(patch).toContain("+three");
    });

    test("a clean comparison has no patch or report", () => {
        const root = temporaryDirectory();
        const base = path.join(root, "base");
        const head = path.join(root, "head");
        fs.mkdirSync(base);
        fs.mkdirSync(head);
        fs.writeFileSync(path.join(base, "same.ts"), "same\n");
        fs.writeFileSync(path.join(head, "same.ts"), "same\n");

        const { patch, result } = compareOutputSnapshots(base, head);

        expect(result.hasDifferences).toBe(false);
        expect(patch).toBe("");
        expect(() =>
            renderOutputDiffReport({
                baseSha: "base",
                headSha: "head",
                patch,
                prSha: "merge",
                prUrl: "https://github.com/glideapps/quicktype/pull/1",
                result,
            }),
        ).toThrow("no report");
    });

    test("renders escaped output and a pull-request backlink", () => {
        const root = temporaryDirectory();
        const base = path.join(root, "base");
        const head = path.join(root, "head");
        fs.mkdirSync(base);
        fs.mkdirSync(head);
        fs.writeFileSync(path.join(base, "unsafe.ts"), "safe\n");
        fs.writeFileSync(
            path.join(head, "unsafe.ts"),
            "<script>alert(1)</script>\n",
        );
        const { patch, result } = compareOutputSnapshots(base, head);

        const html = renderOutputDiffReport({
            baseSha: "base-sha",
            headSha: "head-sha",
            patch,
            prSha: "pr-sha",
            prUrl: "https://github.com/glideapps/quicktype/pull/123",
            result,
        });

        expect(html).toContain("Back to the pull request");
        expect(html).toContain(
            "https://github.com/glideapps/quicktype/pull/123",
        );
        expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain('class="diff-table"');
        expect(html).toContain(">Expand all</button>");
        expect(html).toContain(
            'class="blob-num old" data-line-number="1">1</td>',
        );
        expect(html).toContain(
            'class="blob-num new" data-line-number="1">1</td>',
        );
        expect(html).not.toContain("diff --git");
    });
});
