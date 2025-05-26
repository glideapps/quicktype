#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";

import chalk from "chalk";

import {
    IssueAnnotationData,
    type SerializedRenderResult,
    quicktypeMultiFile,
} from "quicktype-core";

import { parseCLIOptions } from "./cli.options";
import { inferCLIOptions } from "./inference";
import { makeQuicktypeOptions } from "./quicktype.options";
import type { CLIOptions } from "./CLIOptions.types";
export type { CLIOptions };

export function writeOutput(
    cliOptions: CLIOptions,
    resultsByFilename: ReadonlyMap<string, SerializedRenderResult>,
): void {
    let isFirstRun = true;
    for (const [filename, { lines, annotations }] of resultsByFilename) {
        const output = lines.join("\n");

        if (cliOptions.out !== undefined) {
            fs.writeFileSync(
                path.join(path.dirname(cliOptions.out), filename),
                output,
            );
        } else {
            if (!isFirstRun) {
                process.stdout.write("\n");
            }

            if (resultsByFilename.size > 1) {
                process.stdout.write(`// ${filename}\n\n`);
            }

            process.stdout.write(output);
        }

        if (cliOptions.quiet) {
            continue;
        }

        for (const sourceAnnotation of annotations) {
            const annotation = sourceAnnotation.annotation;
            if (!(annotation instanceof IssueAnnotationData)) {
                continue;
            }

            const lineNumber = sourceAnnotation.span.start.line;
            const humanLineNumber = lineNumber + 1;
            console.error(
                `\nIssue in line ${humanLineNumber}: ${annotation.message}`,
            );
            console.error(`${humanLineNumber}: ${lines[lineNumber]}`);
        }

        isFirstRun = false;
    }
}

export async function main(
    args: string[] | Partial<CLIOptions>,
): Promise<void> {
    let cliOptions: CLIOptions;
    if (Array.isArray(args)) {
        cliOptions = parseCLIOptions(args);
    } else {
        cliOptions = inferCLIOptions(args, undefined);
    }

    if (cliOptions.telemetry !== undefined) {
        switch (cliOptions.telemetry) {
            case "enable":
                break;
            case "disable":
                break;
            default:
                console.error(
                    chalk.red("telemetry must be 'enable' or 'disable'"),
                );
                return;
        }

        if (Array.isArray(args) && args.length === 2) {
            // This was merely a CLI run to set telemetry and we should not proceed
            return;
        }
    }

    const quicktypeOptions = await makeQuicktypeOptions(cliOptions);
    if (quicktypeOptions === undefined) {
        return;
    }

    const resultsByFilename = await quicktypeMultiFile(quicktypeOptions);

    writeOutput(cliOptions, resultsByFilename);
}

if (require.main === module) {
    main(process.argv.slice(2)).catch((e) => {
        if (e instanceof Error) {
            console.error(`Error: ${e.message}.`);
        } else {
            console.error(e);
        }

        process.exit(1);
    });
}
