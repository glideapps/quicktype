import * as fs from "fs";

import * as _ from "lodash";
import * as shell from "shelljs";

import { main as quicktype_, CLIOptions } from "../dist/cli";
import { RendererOptions } from "../dist/quicktype-core/Run";
import * as languages from "./languages";
import deepEquals from "./lib/deepEquals";

const chalk = require("chalk");
const strictDeepEquals: (x: any, y: any) => boolean = require("deep-equal");

const DEBUG = process.env.DEBUG !== undefined;
const ASSUME_STRINGS_EQUAL = process.env.ASSUME_STRINGS_EQUAL !== undefined;

export function debug<T>(x: T): T {
  if (DEBUG) {
    console.log(x);
  }
  return x;
}

export function failWith(message: string, obj: any): never {
  obj.cwd = process.cwd();
  console.error(chalk.red(message));
  console.error(chalk.red(JSON.stringify(obj, null, "  ")));
  throw obj;
}

function callAndReportFailure<T>(message: string, f: () => T): T | never {
  try {
    return f();
  } catch (e) {
    return failWith(message, { error: e });
  }
}

export function exec(
  s: string,
  opts: { silent: boolean } = { silent: !DEBUG },
  cb?: any
): { stdout: string; code: number } {
  debug(s);
  const result = shell.exec(s, opts, cb) as any;

  if (result.code !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    failWith("Command failed", {
      command: s,
      code: result.code
    });
  }

  return result;
}

export function execAsync(s: string, opts: { silent: boolean } = { silent: !DEBUG }) {
  return new Promise<{ stdout: string; code: number }>((resolve, reject) => {
    debug(s);
    shell.exec(s, opts, (code, stdout, stderr) => {
      if (code !== 0) {
        console.error(stdout);
        console.error(stderr);
        reject({ command: s, code });
      }
      resolve({ stdout, code });
    });
  });
}

async function time<T>(work: () => Promise<T>): Promise<[T, number]> {
  let start = +new Date();
  let result = await work();
  let end = +new Date();
  return [result, end - start];
}

export async function quicktype(opts: Partial<CLIOptions>) {
  await time(async () => {
    await quicktype_(opts);
  });
}

export async function quicktypeForLanguage(
  language: languages.Language,
  sourceFile: string,
  sourceLanguage: string,
  alphabetizeProperties: boolean,
  additionalRendererOptions: RendererOptions,
  graphqlSchema?: string
) {
  try {
    await quicktype({
      srcLang: sourceLanguage,
      lang: language.name,
      src: [sourceFile],
      out: language.output,
      graphqlSchema,
      topLevel: language.topLevel,
      alphabetizeProperties,
      rendererOptions: _.merge({}, language.rendererOptions, additionalRendererOptions),
      quiet: true,
      telemetry: "disable",
      // GraphQL input can leave unreachable types in the graph, which means
      // their provenance won't be propagated.  It does that for non-nullables.
      debug: graphqlSchema === undefined ? "provenance" : undefined
    });
  } catch (e) {
    failWith("quicktype threw an exception", { error: e });
  }
}

export async function inDir(dir: string, work: () => Promise<void>) {
  let origin = process.cwd();

  debug(`cd ${dir}`);
  process.chdir(dir);

  await work();
  process.chdir(origin);
}

export function testsInDir(dir: string, extension: string): string[] {
  return shell.ls(`${dir}/*.${extension}`);
}

export interface Sample {
  path: string;
  additionalRendererOptions: RendererOptions;
  saveOutput: boolean;
}

export function samplesFromPaths(paths: string[]): Sample[] {
  return paths.map(p => ({ path: p, additionalRendererOptions: {}, saveOutput: true }));
}

export function samplesFromSources(
  sources: string[],
  prioritySamples: string[],
  miscSamples: string[],
  extension: string
): { priority: Sample[]; others: Sample[] } {
  if (sources.length === 0) {
    return {
      priority: samplesFromPaths(prioritySamples),
      others: samplesFromPaths(miscSamples)
    };
  } else if (sources.length === 1 && fs.lstatSync(sources[0]).isDirectory()) {
    return {
      priority: samplesFromPaths(testsInDir(sources[0], extension)),
      others: []
    };
  } else {
    return { priority: samplesFromPaths(sources), others: [] };
  }
}

type ComparisonArgs = {
  expectedFile: string;
  given: { file: string } | { command: string };
  strict: boolean;
  allowMissingNull?: boolean;
};

export function compareJsonFileToJson(args: ComparisonArgs) {
  debug(args);

  const { expectedFile, strict } = args;
  const given: any = args.given;

  const jsonString = given.file
    ? callAndReportFailure("Could not read JSON output file", () => fs.readFileSync(given.file, "utf8"))
    : callAndReportFailure("Could not run command for JSON output", () => exec(given.command).stdout);

  const givenJSON = callAndReportFailure("Could not parse output JSON", () => JSON.parse(jsonString));
  const expectedJSON = callAndReportFailure("Could not read or parse expected JSON file", () =>
    JSON.parse(fs.readFileSync(expectedFile, "utf8"))
  );

  const allowMissingNull = !!args.allowMissingNull;
  let jsonAreEqual = strict
    ? callAndReportFailure("Failed to strictly compare objects", () =>
        strictDeepEquals(givenJSON, expectedJSON)
      )
    : callAndReportFailure("Failed to compare objects.", () =>
        deepEquals(expectedJSON, givenJSON, allowMissingNull, ASSUME_STRINGS_EQUAL)
      );

  if (!jsonAreEqual) {
    failWith("Error: Output is not equivalent to input.", {
      expectedFile,
      given
    });
  }
}
