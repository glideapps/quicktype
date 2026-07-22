#!/usr/bin/env tsx

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

type FileStatus = "added" | "deleted" | "modified";

export interface OutputDiffFile {
    additions: number;
    deletions: number;
    path: string;
    status: FileStatus;
}

export interface OutputDiffResult {
    files: OutputDiffFile[];
    hasDifferences: boolean;
    summary: {
        added: number;
        changedLines: number;
        deleted: number;
        deletions: number;
        files: number;
        insertions: number;
        modified: number;
    };
    version: 1;
}

function filesBelow(root: string, current = root): string[] {
    if (!fs.existsSync(current)) return [];
    return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) return filesBelow(root, fullPath);
        return entry.isFile() ? [path.relative(root, fullPath)] : [];
    });
}

function buffersEqual(left: string, right: string): boolean {
    const leftStat = fs.statSync(left);
    const rightStat = fs.statSync(right);
    if (leftStat.size !== rightStat.size) return false;
    return fs.readFileSync(left).equals(fs.readFileSync(right));
}

export function splitPatch(patch: string): string[] {
    if (patch.length === 0) return [];
    const starts: number[] = [];
    const matcher = /^diff --git /gm;
    for (
        let match = matcher.exec(patch);
        match !== null;
        match = matcher.exec(patch)
    ) {
        starts.push(match.index);
    }
    return starts.map((start, index) =>
        patch.slice(start, starts[index + 1] ?? patch.length).trimEnd(),
    );
}

function lineCounts(patchSection: string): {
    additions: number;
    deletions: number;
} {
    let additions = 0;
    let deletions = 0;
    for (const line of patchSection.split("\n")) {
        if (line.startsWith("+++") || line.startsWith("---")) continue;
        if (line.startsWith("+")) additions++;
        if (line.startsWith("-")) deletions++;
    }
    return { additions, deletions };
}

function generatePatch(baseDirectory: string, headDirectory: string): string {
    const base = path.resolve(baseDirectory);
    const head = path.resolve(headDirectory);
    const sameParent = path.dirname(base) === path.dirname(head);
    const cwd = sameParent ? path.dirname(base) : process.cwd();
    const baseArgument = sameParent ? path.basename(base) : base;
    const headArgument = sameParent ? path.basename(head) : head;
    const diff = spawnSync(
        "git",
        [
            "-c",
            "core.quotePath=false",
            "diff",
            "--no-index",
            "--no-renames",
            "--text",
            "--unified=3",
            "--",
            baseArgument,
            headArgument,
        ],
        { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
    );
    if (diff.status !== 0 && diff.status !== 1) {
        throw new Error(
            `git diff failed (${diff.status ?? "signal"}): ${diff.stderr}`,
        );
    }
    return diff.stdout;
}

export function compareOutputSnapshots(
    baseDirectory: string,
    headDirectory: string,
): { patch: string; result: OutputDiffResult } {
    const baseFiles = new Set(filesBelow(baseDirectory));
    const headFiles = new Set(filesBelow(headDirectory));
    const allFiles = Array.from(new Set([...baseFiles, ...headFiles])).sort();
    const changed = allFiles.flatMap((relativePath): OutputDiffFile[] => {
        if (!baseFiles.has(relativePath)) {
            return [
                {
                    additions: 0,
                    deletions: 0,
                    path: relativePath,
                    status: "added",
                },
            ];
        }
        if (!headFiles.has(relativePath)) {
            return [
                {
                    additions: 0,
                    deletions: 0,
                    path: relativePath,
                    status: "deleted",
                },
            ];
        }
        if (
            buffersEqual(
                path.join(baseDirectory, relativePath),
                path.join(headDirectory, relativePath),
            )
        ) {
            return [];
        }
        return [
            {
                additions: 0,
                deletions: 0,
                path: relativePath,
                status: "modified",
            },
        ];
    });

    const patch =
        changed.length === 0 ? "" : generatePatch(baseDirectory, headDirectory);
    const sections = splitPatch(patch);
    if (sections.length !== changed.length) {
        throw new Error(
            `Expected ${changed.length} patch sections, found ${sections.length}`,
        );
    }
    const files = changed.map((file, index) => ({
        ...file,
        ...lineCounts(sections[index]),
    }));
    const insertions = files.reduce((sum, file) => sum + file.additions, 0);
    const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
    const result: OutputDiffResult = {
        files,
        hasDifferences: files.length > 0,
        summary: {
            added: files.filter(({ status }) => status === "added").length,
            changedLines: insertions + deletions,
            deleted: files.filter(({ status }) => status === "deleted").length,
            deletions,
            files: files.length,
            insertions,
            modified: files.filter(({ status }) => status === "modified")
                .length,
        },
        version: 1,
    };
    return { patch, result };
}

function escapeHTML(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatNumber(value: number): string {
    return new Intl.NumberFormat("en-US").format(value);
}

function validateResult(value: unknown): asserts value is OutputDiffResult {
    if (typeof value !== "object" || value === null)
        throw new Error("Invalid diff result");
    const result = value as Partial<OutputDiffResult>;
    if (result.version !== 1 || !Array.isArray(result.files)) {
        throw new Error("Unsupported diff result");
    }
    if (
        typeof result.hasDifferences !== "boolean" ||
        typeof result.summary !== "object" ||
        result.summary === null
    ) {
        throw new Error("Invalid diff summary");
    }
    const summary = result.summary as Record<string, unknown>;
    for (const key of [
        "added",
        "changedLines",
        "deleted",
        "deletions",
        "files",
        "insertions",
        "modified",
    ]) {
        if (
            !Number.isSafeInteger(summary[key]) ||
            (summary[key] as number) < 0
        ) {
            throw new Error(`Invalid diff summary field: ${key}`);
        }
    }
    for (const file of result.files) {
        if (
            typeof file.path !== "string" ||
            !["added", "deleted", "modified"].includes(file.status) ||
            !Number.isSafeInteger(file.additions) ||
            file.additions < 0 ||
            !Number.isSafeInteger(file.deletions) ||
            file.deletions < 0
        ) {
            throw new Error("Invalid diff file entry");
        }
    }
}

function renderPatchLines(section: string): string {
    let oldLine = 0;
    let newLine = 0;
    let insideHunk = false;
    const rows: string[] = [];

    for (const line of section.split("\n")) {
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunk !== null) {
            oldLine = Number.parseInt(hunk[1], 10);
            newLine = Number.parseInt(hunk[2], 10);
            insideHunk = true;
            rows.push(
                `<tr class="diff-hunk"><td class="blob-num"></td><td class="blob-num"></td><td class="blob-code">${escapeHTML(line)}</td></tr>`,
            );
            continue;
        }
        if (!insideHunk) continue;

        const prefix = line[0] ?? " ";
        const content = line.slice(1);
        let kind: "addition" | "context" | "deletion" | "note";
        let oldNumber = "";
        let newNumber = "";
        if (prefix === "+") {
            kind = "addition";
            newNumber = String(newLine++);
        } else if (prefix === "-") {
            kind = "deletion";
            oldNumber = String(oldLine++);
        } else if (prefix === "\\") {
            kind = "note";
        } else {
            kind = "context";
            oldNumber = String(oldLine++);
            newNumber = String(newLine++);
        }
        rows.push(
            `<tr class="diff-line ${kind}"><td class="blob-num old" data-line-number="${oldNumber}">${oldNumber}</td><td class="blob-num new" data-line-number="${newNumber}">${newNumber}</td><td class="blob-code"><span class="marker">${escapeHTML(prefix)}</span><span class="code">${escapeHTML(content)}</span></td></tr>`,
        );
    }

    return `<table class="diff-table"><tbody>${rows.join("")}</tbody></table>`;
}

export function renderOutputDiffReport(args: {
    baseSha: string;
    headSha: string;
    patch: string;
    prSha: string;
    prUrl: string;
    result: OutputDiffResult;
}): string {
    const { baseSha, headSha, patch, prSha, prUrl, result } = args;
    validateResult(result);
    if (!result.hasDifferences)
        throw new Error("A clean comparison has no report");

    const sections = splitPatch(patch);
    if (sections.length !== result.files.length) {
        throw new Error("Patch and result file counts differ");
    }
    const fixtures = Array.from(
        new Set(result.files.map((file) => file.path.split(path.sep)[0])),
    ).sort();
    const fileHTML = result.files
        .map((file, index) => {
            const fixture = file.path.split(path.sep)[0];
            const statusLetter =
                file.status === "added"
                    ? "A"
                    : file.status === "deleted"
                      ? "D"
                      : "M";
            return `<details class="file" data-path="${escapeHTML(file.path.toLowerCase())}" data-status="${file.status}" data-fixture="${escapeHTML(fixture)}" id="file-${index}" open>
<summary><span class="status ${file.status}">${statusLetter}</span><span class="file-path">${escapeHTML(file.path)}</span><span class="counts"><b>+${formatNumber(file.additions)}</b> <i>−${formatNumber(file.deletions)}</i></span></summary>
<div class="diff">${renderPatchLines(sections[index])}</div>
</details>`;
        })
        .join("\n");
    const fixtureOptions = fixtures
        .map(
            (fixture) =>
                `<option value="${escapeHTML(fixture)}">${escapeHTML(fixture)}</option>`,
        )
        .join("");
    const summary = result.summary;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>quicktype generated-output diff</title>
<style>
:root {
    color-scheme: light dark;
    --bg: #0d1117;
    --panel: #161b22;
    --panel-hover: #1c2128;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --green: #3fb950;
    --red: #f85149;
    --blue: #58a6ff;
    --diff-bg: #0d1117;
    --add-bg: rgba(46, 160, 67, .15);
    --add-num-bg: rgba(46, 160, 67, .3);
    --del-bg: rgba(248, 81, 73, .15);
    --del-num-bg: rgba(248, 81, 73, .3);
    --hunk-bg: rgba(56, 139, 253, .15);
}
* { box-sizing: border-box }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif }
a { color: var(--blue) }
header, main { width: min(1400px, calc(100% - 32px)); margin: auto }
header { padding: 32px 0 20px }
h1 { font-size: 28px; line-height: 1.25; margin: 0 0 8px }
.subtitle, .commits { color: var(--muted) }
.pr-link { display: inline-block; margin-top: 12px; font-weight: 600 }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 12px; margin: 24px 0 }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 16px }
.card strong { display: block; font-size: 24px; line-height: 1.25 }
.card span { color: var(--muted) }
.toolbar { position: sticky; top: 0; z-index: 5; display: flex; gap: 8px; flex-wrap: wrap; padding: 10px; background: color-mix(in srgb, var(--bg) 94%, transparent); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 16px; backdrop-filter: blur(8px) }
input, select, button { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font: inherit; padding: 7px 10px }
input:focus, select:focus, button:focus { border-color: var(--blue); outline: 2px solid color-mix(in srgb, var(--blue) 25%, transparent); outline-offset: -1px }
button { cursor: pointer }
button:hover { background: var(--panel-hover) }
input { flex: 1; min-width: 240px }
.file { border: 1px solid var(--border); border-radius: 6px; background: var(--diff-bg); margin: 16px 0; overflow: hidden }
.file[hidden] { display: none }
.file summary { cursor: pointer; display: flex; align-items: center; gap: 10px; min-height: 46px; padding: 8px 12px; background: var(--panel); font-weight: 600 }
.file summary:hover { background: var(--panel-hover) }
.file[open] summary { border-bottom: 1px solid var(--border) }
.file-path { font: 600 13px/1.5 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; overflow-wrap: anywhere }
.counts { margin-left: auto; white-space: nowrap; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace }
.counts b { color: var(--green) }
.counts i { color: var(--red); font-style: normal }
.status { width: 22px; height: 22px; flex: 0 0 22px; display: inline-grid; place-items: center; border-radius: 50%; font-size: 11px; font-weight: 700; color: #fff }
.status.added { background: #238636 }
.status.deleted { background: #da3633 }
.status.modified { background: #8957e5 }
.diff { overflow: auto; background: var(--diff-bg) }
.diff-table { width: 100%; min-width: max-content; border-spacing: 0; border-collapse: collapse; font: 12px/20px ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; tab-size: 4 }
.blob-num { width: 1%; min-width: 50px; padding: 0 10px; color: var(--muted); text-align: right; vertical-align: top; user-select: none }
.blob-code { padding: 0 16px 0 0; color: var(--text); white-space: pre; vertical-align: top }
.marker { display: inline-block; width: 22px; text-align: center; user-select: none }
.diff-line.addition .blob-code { background: var(--add-bg) }
.diff-line.addition .blob-num { background: var(--add-num-bg); color: var(--text) }
.diff-line.deletion .blob-code { background: var(--del-bg) }
.diff-line.deletion .blob-num { background: var(--del-num-bg); color: var(--text) }
.diff-line.note .blob-code { color: var(--muted) }
.diff-hunk .blob-num, .diff-hunk .blob-code { padding-top: 4px; padding-bottom: 4px; background: var(--hunk-bg); color: var(--blue) }
.empty { display: none; padding: 40px; text-align: center; color: var(--muted) }
footer { padding: 30px 0 50px; color: var(--muted) }
@media (prefers-color-scheme: light) {
    :root {
        --bg: #fff;
        --panel: #f6f8fa;
        --panel-hover: #f3f4f6;
        --border: #d0d7de;
        --text: #1f2328;
        --muted: #656d76;
        --green: #1a7f37;
        --red: #cf222e;
        --blue: #0969da;
        --diff-bg: #fff;
        --add-bg: #e6ffec;
        --add-num-bg: #ccffd8;
        --del-bg: #ffebe9;
        --del-num-bg: #ffd7d5;
        --hunk-bg: #ddf4ff;
    }
}
</style>
</head>
<body>
<header>
<h1>Generated-output differences</h1>
<div class="subtitle">quicktype output changed between the PR base and head revisions.</div>
<a class="pr-link" href="${escapeHTML(prUrl)}">← Back to the pull request</a>
<div class="cards">
<div class="card"><strong>${formatNumber(summary.files)}</strong><span>files differ</span></div>
<div class="card"><strong>${formatNumber(summary.modified)}</strong><span>modified</span></div>
<div class="card"><strong>${formatNumber(summary.added)}</strong><span>new</span></div>
<div class="card"><strong>${formatNumber(summary.deleted)}</strong><span>deleted</span></div>
<div class="card"><strong>${formatNumber(summary.changedLines)}</strong><span>changed lines</span></div>
<div class="card"><strong><span style="color:var(--green)">+${formatNumber(summary.insertions)}</span> <span style="color:var(--red)">−${formatNumber(summary.deletions)}</span></strong><span>insertions / deletions</span></div>
</div>
<div class="commits">Base <code>${escapeHTML(baseSha)}</code> · PR merge <code>${escapeHTML(prSha)}</code> · Head <code>${escapeHTML(headSha)}</code> · <a href="output.diff">raw patch</a></div>
</header>
<main>
<div class="toolbar">
<input id="search" type="search" placeholder="Filter generated files…" aria-label="Filter generated files">
<select id="fixture"><option value="">All targets</option>${fixtureOptions}</select>
<select id="status"><option value="">All statuses</option><option value="modified">Modified</option><option value="added">New</option><option value="deleted">Deleted</option></select>
<button id="expand" type="button">Expand all</button>
<button id="collapse" type="button">Collapse all</button>
</div>
<div id="files">${fileHTML}</div>
<div class="empty" id="empty">No generated files match these filters.</div>
<footer>Generated by quicktype CI. This report is immutable for the tested PR and head SHAs.</footer>
</main>
<script>
const files=[...document.querySelectorAll('.file')],search=document.querySelector('#search'),fixture=document.querySelector('#fixture'),status=document.querySelector('#status'),empty=document.querySelector('#empty');function filter(){const q=search.value.trim().toLowerCase();let visible=0;for(const file of files){const show=(!q||file.dataset.path.includes(q))&&(!fixture.value||file.dataset.fixture===fixture.value)&&(!status.value||file.dataset.status===status.value);file.hidden=!show;if(show)visible++}empty.style.display=visible?'none':'block'}search.addEventListener('input',filter);fixture.addEventListener('change',filter);status.addEventListener('change',filter);document.querySelector('#expand').addEventListener('click',()=>files.forEach(file=>file.open=true));document.querySelector('#collapse').addEventListener('click',()=>files.forEach(file=>file.open=false));
</script>
</body>
</html>`;
}

function writeComparison(
    base: string,
    head: string,
    resultPath: string,
    patchPath: string,
): void {
    const { patch, result } = compareOutputSnapshots(base, head);
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, `${JSON.stringify(result, undefined, 2)}\n`);
    fs.writeFileSync(patchPath, patch);
}

function renderFromFiles(
    resultPath: string,
    patchPath: string,
    outputPath: string,
    metadata: string[],
): void {
    const result: unknown = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    validateResult(result);
    const [prUrl, baseSha, prSha, headSha] = metadata;
    if ([prUrl, baseSha, prSha, headSha].some((value) => value === undefined)) {
        throw new Error(
            "render requires PR URL, base SHA, PR SHA, and head SHA",
        );
    }
    const html = renderOutputDiffReport({
        baseSha,
        headSha,
        patch: fs.readFileSync(patchPath, "utf8"),
        prSha,
        prUrl,
        result,
    });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, html);
}

function main(): void {
    const [command, ...args] = process.argv.slice(2);
    if (command === "compare" && args.length === 4) {
        writeComparison(args[0], args[1], args[2], args[3]);
        return;
    }
    if (command === "render" && args.length === 7) {
        renderFromFiles(args[0], args[1], args[2], args.slice(3));
        return;
    }
    throw new Error(
        "Usage: output-diff.ts compare <base-dir> <head-dir> <result.json> <patch.diff> | render <result.json> <patch.diff> <index.html> <pr-url> <base-sha> <pr-sha> <head-sha>",
    );
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
