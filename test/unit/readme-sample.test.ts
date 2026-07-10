// The README's "Calling quicktype from JavaScript" sample must typecheck
// against the current quicktype-core API under tsc --strict.
//
// quicktype-core 23.1.0 changed the `lang` option of quicktype() and the
// parameter of jsonInputForTargetLanguage() from `string | TargetLanguage`
// to `LanguageName | TargetLanguage`. The README sample at the time wrapped
// quicktype in a helper taking `targetLanguage: string`, so consumers who
// copied it hit TS2345/TS2322 when upgrading — see
// https://github.com/glideapps/quicktype/issues/2905.
//
// This test extracts the TypeScript code blocks from that README section
// and compiles them with tsc --strict against the built quicktype-core.
// It fails if the sample drifts from the API, or if the exports the sample
// relies on (LanguageName, isLanguageName, ...) disappear from the public
// entry point.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

const repositoryRoot = process.cwd();
const readmePath = path.join(repositoryRoot, "README.md");
const coreTypesPath = path.join(
    repositoryRoot,
    "packages",
    "quicktype-core",
    "dist",
    "index.d.ts",
);
const tscPath = path.join(
    repositoryRoot,
    "node_modules",
    "typescript",
    "bin",
    "tsc",
);

const sectionHeading = "### Calling `quicktype` from JavaScript";

// Extracts the fenced ```typescript blocks between `heading` and the next
// heading of the same or higher level.
function typescriptBlocksInSection(
    markdown: string,
    heading: string,
): string[] {
    const start = markdown.indexOf(`${heading}\n`);
    expect(
        start,
        `README section ${JSON.stringify(heading)} exists`,
    ).toBeGreaterThanOrEqual(0);

    const rest = markdown.slice(start + heading.length);
    const nextHeading = rest.search(/\n##+ /);
    const section = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;

    const blocks: string[] = [];
    const fence = /```typescript\n([\s\S]*?)```/g;
    for (
        let match = fence.exec(section);
        match !== null;
        match = fence.exec(section)
    ) {
        blocks.push(match[1]);
    }

    return blocks;
}

let workDirectory: string;

beforeAll(() => {
    workDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "quicktype-readme-sample-"),
    );
});

afterAll(() => {
    fs.rmSync(workDirectory, { recursive: true, force: true });
});

describe("README quicktype-core sample", () => {
    test("typechecks with tsc --strict against the built quicktype-core", () => {
        expect(
            fs.existsSync(coreTypesPath),
            `quicktype-core must be built first (missing ${coreTypesPath}); run "npm run build"`,
        ).toBe(true);

        const readme = fs.readFileSync(readmePath, "utf8");
        const blocks = typescriptBlocksInSection(readme, sectionHeading);
        // The main sample plus the dynamic-language-name snippet.
        expect(blocks.length).toBeGreaterThanOrEqual(2);

        // The snippets are written to concatenate into a single valid
        // module (no duplicate imports or declarations).
        fs.writeFileSync(
            path.join(workDirectory, "sample.ts"),
            blocks.join("\n"),
        );
        fs.writeFileSync(
            path.join(workDirectory, "tsconfig.json"),
            JSON.stringify({
                compilerOptions: {
                    strict: true,
                    noEmit: true,
                    target: "es2020",
                    lib: ["es2020", "dom"],
                    module: "commonjs",
                    moduleResolution: "node",
                    esModuleInterop: true,
                    skipLibCheck: true,
                    types: [],
                    baseUrl: ".",
                    paths: { "quicktype-core": [coreTypesPath] },
                },
                files: ["sample.ts"],
            }),
        );

        // Throws (failing the test with tsc's diagnostics) on any type error.
        execFileSync(process.execPath, [tscPath, "-p", workDirectory], {
            encoding: "utf8",
        });
    });
});
