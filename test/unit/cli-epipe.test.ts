import { spawn } from "node:child_process";
import * as path from "node:path";

import { describe, expect, test } from "vitest";

const repositoryRoot = process.cwd();

function runWithClosedStdout(): Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
}> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [
                path.join(repositoryRoot, "dist", "index.js"),
                "--src-lang",
                "schema",
                "--lang",
                "swift",
                "--just-types",
                path.join(
                    repositoryRoot,
                    "test",
                    "inputs",
                    "schema",
                    "vega-lite.schema",
                ),
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
        );
        let stderr = "";

        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (code, signal) => {
            resolve({ code, signal, stderr });
        });

        child.stdout.destroy();
    });
}

describe("CLI output", () => {
    test("exits successfully when stdout is closed early", async () => {
        const result = await runWithClosedStdout();

        expect(result.signal).toBeNull();
        expect(result.code).toBe(0);
        expect(result.stderr).not.toContain("Error: write EPIPE");
        expect(result.stderr).not.toContain("Unhandled 'error' event");
    });
});
