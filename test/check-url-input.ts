// Guard: URL inputs must work with the native (WHATWG) fetch on Node >= 18.
//
// quicktype-core's $fetch.ts prefers `global.fetch` when it exists. On
// Node >= 18 that is the native (undici) fetch, whose `response.body` is a
// WHATWG ReadableStream, not a Node Readable. NodeIO's readableFromFileOrURL
// used to cast that body straight to a Node Readable, so *every* URL-based
// input failed: JSON URLs with "readStream.setEncoding is not a function"
// (surfaced as "Syntax error in input JSON"), and schema URLs / remote $refs
// with "inputStream.once is not a function" (surfaced as "Could not fetch
// schema"). See issues #2613, #2678, and #2821.
//
// The fixture harness only feeds quicktype local files, so it cannot catch
// this. This check serves a JSON sample and a JSON Schema with a relative
// $ref from a local HTTP server and runs the CLI against the URLs.

import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { main as quicktype } from "../src";

const files: { [name: string]: string } = {
    "sample.json": JSON.stringify({
        veryUniquePropertyName: "quicktype",
        count: 3,
    }),
    "main.schema": JSON.stringify({
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
            referenced: { $ref: "referenced.schema" },
        },
        required: ["referenced"],
    }),
    "referenced.schema": JSON.stringify({
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
            veryUniqueReferencedProperty: { type: "string" },
        },
        required: ["veryUniqueReferencedProperty"],
    }),
};

async function generateTypeScript(
    baseURL: string,
    srcLang: string,
    file: string,
): Promise<string> {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "quicktype-url-"));
    const outPath = path.join(outDir, "out.ts");
    try {
        await quicktype({
            srcLang,
            src: [`${baseURL}/${file}`],
            lang: "typescript",
            out: outPath,
            topLevel: "TopLevel",
            quiet: true,
            telemetry: "disable",
        });
        return fs.readFileSync(outPath, "utf8");
    } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
    }
}

export async function checkURLInput(): Promise<void> {
    const server = http.createServer((req, res) => {
        const content = files[path.basename(req.url ?? "")];
        if (content === undefined) {
            res.writeHead(404);
            res.end();
            return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(content);
    });
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    const baseURL = `http://127.0.0.1:${port}`;

    const failures: string[] = [];
    try {
        try {
            const json = await generateTypeScript(
                baseURL,
                "json",
                "sample.json",
            );
            if (!json.includes("veryUniquePropertyName")) {
                failures.push(
                    `    JSON from URL: output lacks the sample's property:\n${json}`,
                );
            }
        } catch (e) {
            failures.push(`    JSON from URL: quicktype threw: ${e}`);
        }

        try {
            const schema = await generateTypeScript(
                baseURL,
                "schema",
                "main.schema",
            );
            if (!schema.includes("veryUniqueReferencedProperty")) {
                failures.push(
                    `    schema from URL: output lacks the $ref-ed schema's property:\n${schema}`,
                );
            }
        } catch (e) {
            failures.push(`    schema from URL: quicktype threw: ${e}`);
        }
    } finally {
        server.close();
    }

    if (failures.length > 0) {
        console.error(
            `error: URL inputs must work with the native fetch on Node >= 18 (issues #2613, #2678, #2821):

${failures.join("\n")}

readableFromFileOrURL must convert fetch's WHATWG ReadableStream body into a
Node-style Readable — see packages/quicktype-core/src/input/io/NodeIO.ts`,
        );
        process.exit(1);
    }
}

// Allow running the check standalone:
//   NODE_PATH=`pwd`/node_modules npx ts-node --project test/tsconfig.json test/check-url-input.ts
if (require.main === module) {
    checkURLInput().then(() => {
        console.error("* URL inputs work with the native fetch");
    });
}
