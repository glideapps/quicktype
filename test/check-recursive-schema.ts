// Guard: recursively-composed JSON Schemas must not blow the stack.
//
// Schemas with cyclic composition — a type that refers back to itself through
// `allOf`/`anyOf`/`oneOf` — used to make the union-flattening fixpoint diverge,
// crashing with "Maximum call stack size exceeded". Real-world schemas that hit
// this include the FHIR schema (issue #1376) and OPDS 2.0 (issue #2187).
//
// The fixture harness can't guard this: its schema fixtures must also compile
// and round-trip in every target language, and a schema big/gnarly enough to
// trigger the non-convergence produces output that not every language compiles.
// This check only asserts that quicktype *generates* — it never has to compile
// the result — so it can use a schema that reproduces the crash directly.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { main as quicktype } from "../src";

const schemaPath = path.join(
    __dirname,
    "inputs",
    "regressions",
    "recursive-composition.schema",
);

export async function checkRecursiveSchemaConverges(): Promise<void> {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "quicktype-recursive-"));
    const outPath = path.join(outDir, "out.ts");
    try {
        await quicktype({
            srcLang: "schema",
            src: [schemaPath],
            lang: "typescript",
            out: outPath,
            quiet: true,
            telemetry: "disable",
        });
    } catch (e) {
        console.error(
            `error: quicktype failed on a recursively-composed schema (regression of #1376 / #2187):\n${
                e instanceof Error ? e.stack ?? e.message : String(e)
            }`,
        );
        process.exit(1);
    } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
    }
}

// Allow running the check standalone:
//   NODE_PATH=`pwd`/node_modules npx ts-node --project test/tsconfig.json test/check-recursive-schema.ts
if (require.main === module) {
    checkRecursiveSchemaConverges().then(() => {
        console.error("* recursively-composed schema converged");
    });
}
