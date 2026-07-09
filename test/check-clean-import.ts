import { execFileSync } from "node:child_process";
import * as path from "node:path";

// Guard: importing the built quicktype-core must not write to stdout.
//
// quicktype-core's build used to swap in a CI-only fetch shim ($fetch.ci.ts)
// whenever $CI was set — that substitution is gone now — and the shim used to
// start with a top-level console.info, so every published package since
// 23.3.1 printed "=== RUNNING IN CI, USE FETCH.CI ===" on import — corrupting
// redirected CLI output (`quicktype ... > out.ts` produced non-compiling
// code). See https://github.com/glideapps/quicktype/issues/2874.
//
// This check requires the built package in a child process and fails the test
// run if the import produces any stdout output.

export function checkCoreImportKeepsStdoutClean(): void {
    const coreDir = path.join(__dirname, "..", "packages", "quicktype-core");
    const stdout = execFileSync(
        process.execPath,
        ["-e", `require(${JSON.stringify(coreDir)});`],
        { encoding: "utf8" },
    );
    if (stdout !== "") {
        console.error(
            `error: requiring quicktype-core wrote to stdout:

    ${JSON.stringify(stdout)}

Importing quicktype-core must not print anything: CLI users redirect stdout
(quicktype ... > out.ts), so any stray output corrupts generated code. See
https://github.com/glideapps/quicktype/issues/2874`,
        );
        process.exit(1);
    }
}

// Allow running the check standalone:
//   npx ts-node --project test/tsconfig.json test/check-clean-import.ts
if (require.main === module) {
    checkCoreImportKeepsStdoutClean();
    console.error("* importing quicktype-core keeps stdout clean");
}
