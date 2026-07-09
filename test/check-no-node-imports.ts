// This is the Node-only test harness, so "node:" imports are fine *here* —
// the guard below only restricts packages/quicktype-core/src.
import * as fs from "node:fs";
import * as path from "node:path";

// Guard: quicktype-core must stay bundleable for the browser.
//
// quicktype-core's package.json declares `"browser": { "fs": false }`, which
// tells web bundlers (webpack, browserify, ...) to stub out the `fs` module.
// That mapping only matches the *bare* specifier "fs" — an import of
// "node:fs" (or any other "node:"-prefixed builtin) is NOT remapped, so it
// breaks web bundles of quicktype-core even though the code behaves the same
// under Node. This regression already happened once between 23.2.0 and
// 23.2.5: see https://github.com/glideapps/quicktype/issues/2763.
//
// This check fails the test run if any "node:"-prefixed import sneaks back
// into packages/quicktype-core/src. It is scoped to quicktype-core only: the
// CLI in the root `src/` directory is Node-only and may use "node:" imports
// freely.

const coreSrcDir = path.join(
    __dirname,
    "..",
    "packages",
    "quicktype-core",
    "src",
);

// Matches static imports/re-exports (`from "node:fs"`), dynamic imports
// (`import("node:fs")`), and CommonJS requires (`require("node:fs")`).
const nodeImportPattern = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']node:/;

function findNodeImports(dir: string): string[] {
    const offenders: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            offenders.push(...findNodeImports(fullPath));
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
            const lines = fs.readFileSync(fullPath, "utf8").split("\n");
            for (let i = 0; i < lines.length; i++) {
                if (nodeImportPattern.test(lines[i])) {
                    offenders.push(
                        `${path.relative(path.join(__dirname, ".."), fullPath)}:${i + 1}: ${lines[i].trim()}`,
                    );
                }
            }
        }
    }

    return offenders;
}

export function checkCoreHasNoNodePrefixedImports(): void {
    const offenders = findNodeImports(coreSrcDir);
    if (offenders.length > 0) {
        const offenderList = offenders.map((o) => `    ${o}`).join("\n");
        console.error(
            `error: found "node:"-prefixed imports in packages/quicktype-core/src:

${offenderList}

quicktype-core must use bare builtin specifiers (e.g. "fs", not "node:fs"):
its package.json's "browser" field only stubs bare specifiers, so "node:"
imports break web bundlers. See https://github.com/glideapps/quicktype/issues/2763`,
        );
        process.exit(1);
    }
}

// Allow running the check standalone:
//   npx ts-node --project test/tsconfig.json test/check-no-node-imports.ts
if (require.main === module) {
    checkCoreHasNoNodePrefixedImports();
    console.error('* quicktype-core has no "node:"-prefixed imports');
}
