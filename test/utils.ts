"use strict";

import * as fs from "fs";

import { main as quicktype_, Options } from "../cli/quicktype";
import * as languages from "./languages";
import deepEquals from "./lib/deepEquals";

const shell = require("shelljs");
const chalk = require("chalk");
const strictDeepEquals: (x: any, y: any) => boolean = require("deep-equal");

const DEBUG = typeof process.env.DEBUG !== "undefined";

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
  let result = shell.exec(s, opts, cb);

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

async function time<T>(work: () => Promise<T>): Promise<[T, number]> {
  let start = +new Date();
  let result = await work();
  let end = +new Date();
  return [result, end - start];
}

export async function quicktype(opts: Options) {
  let [result, duration] = await time(async () => {
    await quicktype_(opts);
  });
}

export async function quicktypeForLanguage(
  language: languages.Language,
  sourceFile: string,
  sourceLanguage: string
) {
  await quicktype({
    srcLang: sourceLanguage,
    lang: language.name,
    src: [sourceFile],
    out: language.output,
    topLevel: language.topLevel,
    rendererOptions: language.rendererOptions
  });
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

export function samplesFromSources(
  sources: string[],
  prioritySamples: string[],
  miscSamples: string[],
  extension: string
): { priority: string[]; others: string[] } {
  if (sources.length === 0) {
    return { priority: prioritySamples, others: miscSamples };
  } else if (sources.length === 1 && fs.lstatSync(sources[0]).isDirectory()) {
    return { priority: testsInDir(sources[0], extension), others: [] };
  } else {
    return { priority: sources, others: [] };
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
    ? callAndReportFailure("Could not read JSON output file", () =>
        fs.readFileSync(given.file, "utf8")
      )
    : callAndReportFailure(
        "Could not run command for JSON output",
        () => exec(given.command).stdout
      );

  const givenJSON = callAndReportFailure("Could not parse output JSON", () =>
    JSON.parse(jsonString)
  );
  const expectedJSON = callAndReportFailure(
    "Could not read or parse expected JSON file",
    () => JSON.parse(fs.readFileSync(expectedFile, "utf8"))
  );

  const allowMissingNull = !!args.allowMissingNull;
  let jsonAreEqual = strict
    ? callAndReportFailure("Failed to strictly compare objects", () =>
        strictDeepEquals(givenJSON, expectedJSON)
      )
    : callAndReportFailure("Failed to compare objects.", () =>
        deepEquals(expectedJSON, givenJSON, allowMissingNull)
      );

  if (!jsonAreEqual) {
    failWith("Error: Output is not equivalent to input.", {
      expectedFile,
      given
    });
  }
}
