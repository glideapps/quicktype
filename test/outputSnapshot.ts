import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import type { RendererOptions } from "quicktype-core";

type FileState = {
    mtimeMs: number;
    size: number;
};

function filesBelow(root: string, current = root): string[] {
    if (!fs.existsSync(current)) return [];

    return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) return filesBelow(root, fullPath);
        if (!entry.isFile()) return [];
        return [path.relative(root, fullPath)];
    });
}

export function snapshotFileState(root: string): Map<string, FileState> {
    return new Map(
        filesBelow(root).map((relativePath) => {
            const stat = fs.statSync(path.join(root, relativePath));
            return [relativePath, { mtimeMs: stat.mtimeMs, size: stat.size }];
        }),
    );
}

function canonicalRendererOptions(options: RendererOptions): string {
    return JSON.stringify(
        Object.entries(options).sort(([left], [right]) =>
            left.localeCompare(right),
        ),
    );
}

export function rendererOptionsID(options: RendererOptions): string {
    const canonical = canonicalRendererOptions(options);
    if (canonical === "[]") return "default";

    const readable = Object.entries(options)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}-${String(value)}`)
        .join("__")
        .replace(/[^A-Za-z0-9_.-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    const hash = createHash("sha256")
        .update(canonical)
        .digest("hex")
        .slice(0, 12);
    return `${readable || "options"}--${hash}`;
}

function safeRelativePath(relativePath: string): string {
    const normalized = path.normalize(relativePath);
    if (
        path.isAbsolute(normalized) ||
        normalized === ".." ||
        normalized.startsWith(`..${path.sep}`)
    ) {
        throw new Error(
            `Output snapshot path escapes its root: ${relativePath}`,
        );
    }
    return normalized;
}

export function outputSnapshotCaseDirectory(
    snapshotRoot: string,
    fixtureName: string,
    samplePath: string,
    rendererOptions: RendererOptions,
): string {
    const repositoryRelativeSample = safeRelativePath(
        path.relative(process.cwd(), path.resolve(samplePath)),
    );
    return path.join(
        snapshotRoot,
        fixtureName.replace(/[^A-Za-z0-9_.-]+/g, "-"),
        repositoryRelativeSample,
        rendererOptionsID(rendererOptions),
    );
}

export function saveOutputSnapshot(args: {
    before: Map<string, FileState>;
    fixtureName: string;
    primaryOutput: string;
    rendererOptions: RendererOptions;
    runDirectory: string;
    samplePath: string;
    snapshotRoot: string;
}): string[] {
    const {
        before,
        fixtureName,
        primaryOutput,
        rendererOptions,
        runDirectory,
        samplePath,
        snapshotRoot,
    } = args;
    const after = snapshotFileState(runDirectory);
    const generated = new Set<string>();

    for (const [relativePath, state] of after) {
        const oldState = before.get(relativePath);
        if (
            oldState === undefined ||
            oldState.size !== state.size ||
            oldState.mtimeMs !== state.mtimeMs
        ) {
            generated.add(relativePath);
        }
    }

    const safePrimaryOutput = safeRelativePath(primaryOutput);
    if (fs.existsSync(path.join(runDirectory, safePrimaryOutput))) {
        generated.add(safePrimaryOutput);
    }

    const caseDirectory = outputSnapshotCaseDirectory(
        snapshotRoot,
        fixtureName,
        samplePath,
        rendererOptions,
    );
    const saved = Array.from(generated).sort();
    for (const relativePath of saved) {
        const safePath = safeRelativePath(relativePath);
        const destination = path.join(caseDirectory, safePath);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(runDirectory, safePath), destination);
    }
    return saved;
}
