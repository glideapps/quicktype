import * as process from "process";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as _ from "lodash";

import { main as quicktype_, Options } from "../cli/quicktype";

import { inParallel } from "./lib/multicore";
import deepEquals from "./lib/deepEquals";
import { randomBytes } from "crypto";

const Ajv = require("ajv");
const strictDeepEquals: (x: any, y: any) => boolean = require("deep-equal");
const shell = require("shelljs");

const Main = require("../output/Main");
const Samples = require("../output/Samples");

const exit = require("exit");
const chalk = require("chalk");

//////////////////////////////////////
// Constants
/////////////////////////////////////

const IS_CI = process.env.CI === "true";
const BRANCH = process.env.TRAVIS_BRANCH;
const IS_BLESSED = ["master"].indexOf(BRANCH) !== -1;
const IS_PUSH = process.env.TRAVIS_EVENT_TYPE === "push";
const IS_PR =
  process.env.TRAVIS_PULL_REQUEST &&
  process.env.TRAVIS_PULL_REQUEST !== "false";
const DEBUG = typeof process.env.DEBUG !== "undefined";

const CPUs = +process.env.CPUs || os.cpus().length;

function debug<T>(x: T): T {
  if (DEBUG) {
    console.log(x);
  }
  return x;
}

function samplesFromSources(
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

//////////////////////////////////////
// Fixtures
/////////////////////////////////////

abstract class Fixture {
  abstract name: string;

  runForName(name: string): boolean {
    return this.name === name;
  }

  async setup(): Promise<void> {
    return;
  }

  abstract getSamples(
    sources: string[]
  ): { priority: string[]; others: string[] };

  abstract runWithSample(
    sample: string,
    index: number,
    total: number
  ): Promise<void>;

  getRunDirectory(): string {
    return `test/runs/${this.name}-${randomBytes(3).toString("hex")}`;
  }

  printRunMessage(
    sample: string,
    index: number,
    total: number,
    cwd: string,
    shouldSkip: boolean
  ): void {
    console.error(
      `*`,
      chalk.dim(`[${index + 1}/${total}]`),
      chalk.magenta(this.name),
      path.join(cwd, chalk.cyan(path.basename(sample))),
      shouldSkip ? chalk.red("SKIP") : ""
    );
  }
}

interface Language {
  name: string;
  base: string;
  setupCommand: string;
  compileCommand: string;
  runCommand(sample: string): string;
  diffViaSchema: boolean;
  allowMissingNull: boolean;
  output: string;
  topLevel: string;
  skipJSON: string[];
}

async function quicktypeForLanguage(
  language: Language,
  sourceFile: string,
  sourceLanguage: string
) {
  await quicktype({
    srcLang: sourceLanguage,
    lang: language.name,
    src: [sourceFile],
    out: language.output,
    topLevel: language.topLevel
  });
}

abstract class LanguageFixture extends Fixture {
  protected language: Language;

  public constructor(language: Language) {
    super();
    this.language = language;
  }

  async setup() {
    if (!this.language.setupCommand) {
      return;
    }

    console.error(`* Setting up`, chalk.magenta(this.name), `fixture`);

    await inDir(this.language.base, async () => {
      exec(this.language.setupCommand);
    });
  }

  abstract shouldSkipTest(sample: string): boolean;
  abstract async runQuicktype(sample: string): Promise<void>;
  abstract async test(sample: string, additionalFiles: string[]): Promise<void>;

  additionalFiles(sample: string): string[] {
    return [];
  }

  async runWithSample(sample: string, index: number, total: number) {
    const cwd = this.getRunDirectory();
    let sampleFile = path.basename(sample);
    let shouldSkip = this.shouldSkipTest(sample);
    const additionalFiles = this.additionalFiles(sample);

    this.printRunMessage(sample, index, total, cwd, shouldSkip);

    if (shouldSkip) {
      return;
    }

    shell.cp("-R", this.language.base, cwd);
    shell.cp.apply(null, _.concat(sample, additionalFiles, cwd));

    await inDir(cwd, async () => {
      await this.runQuicktype(sampleFile);

      try {
        await this.test(sampleFile, additionalFiles);
      } catch (e) {
        failWith("Fixture threw an exception", { error: e });
      }
    });

    shell.rm("-rf", cwd);
  }
}

class JSONFixture extends LanguageFixture {
  public name: string;

  public constructor(language: Language) {
    super(language);
    this.name = language.name;
  }

  async runQuicktype(sample: string): Promise<void> {
    await quicktypeForLanguage(this.language, sample, "json");
  }

  async test(sample: string, additionalFiles: string[]): Promise<void> {
    if (this.language.compileCommand) {
      exec(this.language.compileCommand);
    }
    compareJsonFileToJson({
      expectedFile: sample,
      jsonCommand: this.language.runCommand(sample),
      strict: false,
      allowMissingNull: this.language.allowMissingNull
    });

    if (this.language.diffViaSchema) {
      debug("* Diffing with code generated via JSON Schema");
      // Make a schema
      await quicktype({
        src: [sample],
        lang: "schema",
        out: "schema.json",
        topLevel: this.language.topLevel
      });
      // Quicktype from the schema and compare to expected code
      shell.mv(this.language.output, `${this.language.output}.expected`);
      await quicktypeForLanguage(this.language, "schema.json", "schema");

      // Compare fixture.output to fixture.output.expected
      exec(
        `diff -Naur ${this.language.output}.expected ${this.language
          .output} > /dev/null 2>&1`
      );
    }
  }

  shouldSkipTest(sample: string): boolean {
    if (fs.statSync(sample).size > 32 * 1024 * 1024) {
      return true;
    }
    return _.includes(this.language.skipJSON, path.basename(sample));
  }

  getSamples(sources: string[]): { priority: string[]; others: string[] } {
    // FIXME: this should only run once
    const prioritySamples = _.concat(
      testsInDir("test/inputs/json/priority", "json"),
      testsInDir("test/inputs/json/samples", "json")
    );

    const miscSamples = testsInDir("test/inputs/json/misc", "json");

    let { priority, others } = samplesFromSources(
      sources,
      prioritySamples,
      miscSamples,
      "json"
    );

    if (IS_CI && !IS_PR && !IS_BLESSED) {
      // Run only priority sources on low-priority CI branches
      priority = prioritySamples;
      others = [];
    } else if (IS_CI) {
      // On CI, we run a maximum number of test samples. First we test
      // the priority samples to fail faster, then we continue testing
      // until testMax with random sources.
      const testMax = 100;
      priority = prioritySamples;
      others = _.chain(miscSamples)
        .shuffle()
        .take(testMax - prioritySamples.length)
        .value();
    }

    return { priority, others };
  }
}

//////////////////////////////////////
// C# tests
/////////////////////////////////////

const CSharpLanguage: Language = {
  name: "csharp",
  base: "test/fixtures/csharp",
  // https://github.com/dotnet/cli/issues/1582
  setupCommand: "dotnet restore --no-cache",
  compileCommand: null,
  runCommand(sample: string) {
    return `dotnet run "${sample}"`;
  },
  diffViaSchema: true,
  allowMissingNull: false,
  output: "QuickType.cs",
  topLevel: "TopLevel",
  skipJSON: []
};

//////////////////////////////////////
// Java tests
/////////////////////////////////////

const JavaLanguage: Language = {
  name: "java",
  base: "test/fixtures/java",
  setupCommand: null,
  compileCommand: "mvn package",
  runCommand(sample: string) {
    return `java -cp target/QuickTypeTest-1.0-SNAPSHOT.jar io.quicktype.App "${sample}"`;
  },
  diffViaSchema: false,
  allowMissingNull: false,
  output: "src/main/java/io/quicktype/TopLevel.java",
  topLevel: "TopLevel",
  skipJSON: ["identifiers.json", "simple-identifiers.json", "blns-object.json"]
};

//////////////////////////////////////
// Go tests
/////////////////////////////////////

const GoLanguage: Language = {
  name: "golang",
  base: "test/fixtures/golang",
  setupCommand: null,
  compileCommand: null,
  runCommand(sample: string) {
    return `go run main.go quicktype.go < "${sample}"`;
  },
  diffViaSchema: true,
  allowMissingNull: false,
  output: "quicktype.go",
  topLevel: "TopLevel",
  skipJSON: ["identifiers.json", "simple-identifiers.json", "blns-object.json"]
};

//////////////////////////////////////
// JSON Schema tests
/////////////////////////////////////

class JSONSchemaJSONFixture extends JSONFixture {
  private runLanguage: Language;

  constructor(language: Language) {
    const schemaLanguage: Language = {
      name: "schema",
      base: language.base,
      setupCommand: language.setupCommand,
      compileCommand: null,
      runCommand: (sample: string) => {
        throw "This must not be called!";
      },
      diffViaSchema: false,
      allowMissingNull: language.allowMissingNull,
      output: "schema.json",
      topLevel: "schema",
      skipJSON: [
        "identifiers.json",
        "simple-identifiers.json",
        "blns-object.json"
      ]
    };
    super(schemaLanguage);
    this.runLanguage = language;
    this.name = `schema-json-${language.name}`;
  }

  runForName(name: string): boolean {
    return this.name === name || name === "schema-json";
  }

  async test(sample: string, additionalFiles: string[]) {
    let input = JSON.parse(fs.readFileSync(sample, "utf8"));
    let schema = JSON.parse(fs.readFileSync("schema.json", "utf8"));

    let ajv = new Ajv();
    let valid = ajv.validate(schema, input);
    if (!valid) {
      failWith("Generated schema does not validate input JSON.", {
        sample
      });
    }

    // Generate code from the schema
    await quicktypeForLanguage(this.runLanguage, "schema.json", "schema");

    // Parse the sample with the code generated from its schema, and compare to the sample
    compareJsonFileToJson({
      expectedFile: sample,
      jsonCommand: this.runLanguage.runCommand(sample),
      strict: false,
      allowMissingNull: this.runLanguage.allowMissingNull
    });

    // Generate a schema from the schema, making sure the schemas are the same
    let schemaSchema = "schema-from-schema.json";
    await quicktype({
      src: ["schema.json"],
      srcLang: "schema",
      lang: "schema",
      out: schemaSchema
    });
    compareJsonFileToJson({
      expectedFile: "schema.json",
      jsonFile: schemaSchema,
      strict: true
    });
  }
}

//////////////////////////////////////
// Elm tests
/////////////////////////////////////

const ElmLanguage: Language = {
  name: "elm",
  base: "test/fixtures/elm",
  setupCommand: "rm -rf elm-stuff/build-artifacts && elm-make --yes",
  compileCommand: "elm-make Main.elm QuickType.elm --output elm.js",
  runCommand(sample: string) {
    return `node ./runner.js "${sample}"`;
  },
  diffViaSchema: true,
  allowMissingNull: false,
  output: "QuickType.elm",
  topLevel: "QuickType",
  skipJSON: ["identifiers.json", "simple-identifiers.json", "blns-object.json"]
};

//////////////////////////////////////
// Swift tests
/////////////////////////////////////

function makeSwiftLanguage(name: string): Language {
  return {
    name: name,
    base: "test/fixtures/swift",
    setupCommand: null,
    compileCommand: `swiftc -o quicktype main.swift quicktype.swift`,
    runCommand(sample: string) {
      return `./quicktype "${sample}"`;
    },
    diffViaSchema: false,
    allowMissingNull: true,
    output: "quicktype.swift",
    topLevel: "TopLevel",
    skipJSON: ["identifiers.json", "no-classes.json", "blns-object.json"]
  };
}

const Swift3Language: Language = makeSwiftLanguage("swift3");
const Swift4Language: Language = makeSwiftLanguage("swift4");

//////////////////////////////////////
// TypeScript test
/////////////////////////////////////

const TypeScriptLanguage: Language = {
  name: "typescript",
  base: "test/fixtures/typescript",
  setupCommand: null,
  compileCommand: null,
  runCommand(sample: string) {
    // We have to unset TS_NODE_PROJECT because it gets set on the workers
    // to the root test/tsconfig.json
    return `TS_NODE_PROJECT= ts-node main.ts \"${sample}\"`;
  },
  diffViaSchema: true,
  allowMissingNull: false,
  output: "TopLevel.ts",
  topLevel: "TopLevel",
  skipJSON: ["identifiers.json"]
};

//////////////////////////////////////
// JSON Schema fixture
/////////////////////////////////////

class JSONSchemaFixture extends LanguageFixture {
  name: string;

  constructor(language: Language) {
    super(language);
    this.name = `schema-${language.name}`;
  }

  runForName(name: string): boolean {
    return this.name === name || name === "schema";
  }

  getSamples(sources: string[]) {
    const prioritySamples = testsInDir("test/inputs/schema/", "schema");

    return samplesFromSources(sources, prioritySamples, [], "schema");
  }

  shouldSkipTest(sample: string): boolean {
    return false;
  }

  async runQuicktype(sample: string): Promise<void> {
    await quicktypeForLanguage(this.language, sample, "schema");
  }

  additionalFiles(sample: string): string[] {
    const base = path.join(
      path.dirname(sample),
      path.basename(sample, ".schema")
    );
    const jsonFiles: string[] = [];
    let fn = `${base}.json`;
    if (fs.existsSync(fn)) {
      jsonFiles.push(fn);
    }
    let i = 1;
    for (;;) {
      fn = `${base}.${i.toString()}.json`;
      if (fs.existsSync(fn)) {
        jsonFiles.push(fn);
      } else {
        break;
      }
      i++;
    }

    if (jsonFiles.length === 0) {
      failWith("No JSON input files", { base });
    }
    return jsonFiles;
  }

  async test(sample: string, jsonFiles: string[]): Promise<void> {
    if (this.language.compileCommand) {
      exec(this.language.compileCommand);
    }
    for (const json of jsonFiles) {
      const jsonBase = path.basename(json);
      compareJsonFileToJson({
        expectedFile: jsonBase,
        jsonCommand: this.language.runCommand(jsonBase),
        strict: false,
        allowMissingNull: this.language.allowMissingNull
      });
    }
  }
}

const allFixtures: Fixture[] = [
  new JSONFixture(CSharpLanguage),
  new JSONFixture(JavaLanguage),
  new JSONFixture(GoLanguage),
  new JSONFixture(ElmLanguage),
  new JSONFixture(Swift3Language),
  new JSONFixture(Swift4Language),
  new JSONFixture(TypeScriptLanguage),
  new JSONSchemaJSONFixture(GoLanguage),
  new JSONSchemaFixture(CSharpLanguage),
  new JSONSchemaFixture(JavaLanguage),
  new JSONSchemaFixture(GoLanguage),
  new JSONSchemaFixture(Swift3Language),
  new JSONSchemaFixture(Swift4Language),
  new JSONSchemaFixture(TypeScriptLanguage)
];

//////////////////////////////////////
// Test driver
/////////////////////////////////////

function failWith(message: string, obj: any) {
  obj.cwd = process.cwd();
  console.error(chalk.red(message));
  console.error(chalk.red(JSON.stringify(obj, null, "  ")));
  throw obj;
}

async function time<T>(work: () => Promise<T>): Promise<[T, number]> {
  let start = +new Date();
  let result = await work();
  let end = +new Date();
  return [result, end - start];
}

async function quicktype(opts: Options) {
  let [result, duration] = await time(async () => {
    await quicktype_(opts);
  });
}

function exec(
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

function callAndReportFailure<T>(message: string, f: () => T): T {
  try {
    return f();
  } catch (e) {
    failWith(message, { error: e });
  }
}

type ComparisonArgs = {
  expectedFile: string;
  jsonFile?: string;
  jsonCommand?: string;
  strict: boolean;
  allowMissingNull?: boolean;
};

function compareJsonFileToJson(args: ComparisonArgs) {
  debug(args);

  let { expectedFile, jsonFile, jsonCommand, strict } = args;

  const jsonString = jsonFile
    ? callAndReportFailure("Could not read JSON output file", () =>
        fs.readFileSync(jsonFile, "utf8")
      )
    : callAndReportFailure(
        "Could not run command for JSON output",
        () => exec(jsonCommand).stdout
      );

  const givenJSON = callAndReportFailure("Could not parse output JSON", () =>
    JSON.parse(jsonString)
  );
  const expectedJSON = callAndReportFailure(
    "Could not read or parse expected JSON file",
    () => JSON.parse(fs.readFileSync(expectedFile, "utf8"))
  );

  const allowMissingNull =
    args.allowMissingNull === undefined ? false : args.allowMissingNull;
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
      jsonCommand,
      jsonFile
    });
  }
}

async function inDir(dir: string, work: () => Promise<void>) {
  let origin = process.cwd();

  debug(`cd ${dir}`);
  process.chdir(dir);

  await work();
  process.chdir(origin);
}

type WorkItem = { sample: string; fixtureName: string };

async function main(sources: string[]) {
  let fixtures = allFixtures;
  if (process.env.FIXTURE) {
    const fixtureNames = process.env.FIXTURE.split(",");
    fixtures = _.filter(fixtures, fixture =>
      _.some(fixtureNames, name => fixture.runForName(name))
    );
  }
  // Get an array of all { sample, fixtureName } objects we'll run
  const samples = _.map(fixtures, fixture => ({
    fixtureName: fixture.name,
    samples: fixture.getSamples(sources)
  }));
  const priority = _.flatMap(samples, x =>
    _.map(x.samples.priority, s => ({ fixtureName: x.fixtureName, sample: s }))
  );
  const others = _.flatMap(samples, x =>
    _.map(x.samples.others, s => ({ fixtureName: x.fixtureName, sample: s }))
  );

  const tests = _.concat(_.shuffle(priority), _.shuffle(others));

  await inParallel({
    queue: tests,
    workers: CPUs,

    setup: async () => {
      testCLI();

      console.error(
        `* Running ${tests.length} tests between ${fixtures.length} fixtures`
      );

      for (const fixture of fixtures) {
        exec(`rm -rf test/runs`);
        exec(`mkdir -p test/runs`);

        await fixture.setup();
      }
    },

    map: async ({ sample, fixtureName }: WorkItem, index) => {
      let fixture = _.find(fixtures, { name: fixtureName });
      try {
        await fixture.runWithSample(sample, index, tests.length);
      } catch (e) {
        console.trace(e);
        exit(1);
      }
    }
  });
}

function testCLI() {
  console.log(`* CLI sanity check`);
  const qt = "node output/quicktype.js";
  exec(`${qt} --help`);
}

function testsInDir(dir: string, extension: string): string[] {
  return shell.ls(`${dir}/*.${extension}`);
}

// skip 2 `node` args
main(process.argv.slice(2)).catch(reason => {
  console.error(reason);
  process.exit(1);
});
