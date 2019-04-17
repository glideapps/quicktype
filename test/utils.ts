import * as fs from "fs";
import * as path from "path";

import * as _ from "lodash";
import * as shell from "shelljs";
import JSON5 from 'json5';

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

export function failWith(message: string, obj: { [key: string]: any }): never {
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

export function callAndExpectFailure<T>(message: string, f: () => T): void {
  let result: T;
  try {
    result = f();
  } catch {
    return;
  }
  return failWith(message, { result });
}

export function exec(
  s: string,
  env: NodeJS.ProcessEnv | undefined,
  printFailure: boolean = true
): { stdout: string; code: number } {
  debug(s);
  if (env === undefined) {
    env = process.env;
  }
  const result = shell.exec(s, { silent: !DEBUG, env }) as any;

  if (result.code !== 0) {
    const failureObj = {
      command: s,
      code: result.code
    };
    if (!printFailure) {
      throw failureObj;
    }
    console.error(result.stdout);
    console.error(result.stderr);
    failWith("Command failed", failureObj);
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

// FIXME: This is from build-utils.js.  Don't duplicate code.
export function mkdirs(dir: string): void {
  const components = dir.split(path.sep);
  if (components.length === 0) {
    throw new Error("mkdirs must be called with at least one path component");
  }
  let soFar: string;
  if (components[0].length === 0) {
    soFar = "/";
    components.shift();
  } else {
    soFar = ".";
  }
  for (const c of components) {
    soFar = path.join(soFar, c);
    try {
      fs.mkdirSync(soFar);
    } catch (e) {
      const stat = fs.statSync(soFar);
      if (stat.isDirectory()) continue;
      throw e;
    }
  }
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
    failWith("quicktype threw an exception", {
      error: e,
      languageName: language.name,
      sourceFile,
      sourceLanguage,
      graphqlSchema,
      additionalRendererOptions
    });
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

export type ComparisonRelaxations = {
  allowMissingNull?: boolean;
  allowStringifiedIntegers?: boolean;
};

export type FileOrCommand = { file: string } | { command: string; env: NodeJS.ProcessEnv };

function fileOrCommandIsFile(foc: FileOrCommand): foc is { file: string } {
  return (foc as any).file !== undefined;
}

export type ComparisonArgs = ComparisonRelaxations & {
  expectedFile: string;
  given: FileOrCommand;
  strict: boolean;
};

export function compareJsonFileToJson(args: ComparisonArgs) {
  debug(args);

  const { expectedFile, strict } = args;
  const { given } = args;

  const jsonString = fileOrCommandIsFile(given)
    ? callAndReportFailure("Could not read JSON output file", () => fs.readFileSync(given.file, "utf8"))
    : callAndReportFailure(
        "Could not run command for JSON output",
        () => exec(given.command, given.env).stdout
      );

  const givenJSON = callAndReportFailure("Could not parse output JSON", () => JSON5.parse(jsonString));
  const expectedJSON = callAndReportFailure("Could not read or parse expected JSON file", () =>
    JSON5.parse(fs.readFileSync(expectedFile, "utf8"))
  );

  let jsonAreEqual = strict
    ? callAndReportFailure("Failed to strictly compare objects", () =>
        strictDeepEquals(givenJSON, expectedJSON)
      )
    : callAndReportFailure("Failed to compare objects.", () =>
        deepEquals(expectedJSON, givenJSON, ASSUME_STRINGS_EQUAL, args)
      );

  if (!jsonAreEqual) {
    failWith("Error: Output is not equivalent to input.", {
      expectedFile,
      given
    });
  }
}
