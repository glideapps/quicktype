// Runs after `tsc -p tsconfig.esm.json` as part of `npm run build:esm`.
//
// Drops a `{"type": "module"}` marker package.json into dist/esm so that
// Node (and TypeScript under moduleResolution node16/nodenext) treats the
// .js and .d.ts files in that tree as ES modules, while the CommonJS build
// in dist/ keeps the CJS default from the package root. This nested-marker
// layout is the standard way to publish a dual CJS/ESM package from a
// single package.json.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
writeFileSync(
    join(packageRoot, "dist", "esm", "package.json"),
    `${JSON.stringify({ type: "module" }, undefined, 4)}\n`,
);
