"use strict";

import * as _ from "lodash";
import * as path from "path";
import * as fs from "fs";
import { randomBytes } from "crypto";

const Ajv = require("ajv");

import {
  compareJsonFileToJson,
  debug,
  exec,
  failWith,
  inDir,
  quicktype,
  quicktypeForLanguage,
  samplesFromSources,
  testsInDir
} from "./utils";
import * as languages from "./languages";

const chalk = require("chalk");
const shell = require("shelljs");

const IS_CI = process.env.CI === "true";
const BRANCH = process.env.TRAVIS_BRANCH;
const IS_BLESSED = BRANCH === "master";
const IS_PR =
  process.env.TRAVIS_PULL_REQUEST &&
  process.env.TRAVIS_PULL_REQUEST !== "false";

export abstract class Fixture {
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

abstract class LanguageFixture extends Fixture {
  protected language: languages.Language;

  public constructor(language: languages.Language) {
    super();
    this.language = language;
  }

  async setup() {
    const setupCommand = this.language.setupCommand;
    if (!setupCommand) {
      return;
    }

    console.error(`* Setting up`, chalk.magenta(this.name), `fixture`);

    await inDir(this.language.base, async () => {
      exec(setupCommand);
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

  public constructor(
    language: languages.Language,
    name: string = language.name
  ) {
    super(language);
    this.name = name;
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
      given: { command: this.language.runCommand(sample) },
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
        topLevel: this.language.topLevel,
        rendererOptions: {}
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

// This fixture tests generating Schemas from JSON, then
// making sure that they accept the JSON by generating code from
// the Schema and running the code on the original JSON.  Also
// generating a Schema from the Schema and testing that it's
// the same as the original Schema.
class JSONSchemaJSONFixture extends JSONFixture {
  private runLanguage: languages.Language;

  constructor(language: languages.Language) {
    const schemaLanguage: languages.Language = {
      name: "schema",
      base: language.base,
      setupCommand: language.setupCommand,
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
      ],
      rendererOptions: {}
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
      given: { command: this.runLanguage.runCommand(sample) },
      strict: false,
      allowMissingNull: this.runLanguage.allowMissingNull
    });

    // Generate a schema from the schema, making sure the schemas are the same
    let schemaSchema = "schema-from-schema.json";
    await quicktype({
      src: ["schema.json"],
      srcLang: "schema",
      lang: "schema",
      out: schemaSchema,
      rendererOptions: {}
    });
    compareJsonFileToJson({
      expectedFile: "schema.json",
      given: { file: schemaSchema },
      strict: true
    });
  }
}

// This fixture tests generating code from Schema with features
// that we can't (yet) get from JSON.  Right now that's only
// recursive types.
class JSONSchemaFixture extends LanguageFixture {
  name: string;

  constructor(
    language: languages.Language,
    name: string = `schema-${language.name}`
  ) {
    super(language);
    this.name = name;
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
        given: { command: this.language.runCommand(jsonBase) },
        strict: false,
        allowMissingNull: this.language.allowMissingNull
      });
    }
  }
}

export const allFixtures: Fixture[] = [
  new JSONFixture(languages.CSharpLanguage),
  new JSONFixture(languages.NewCSharpLanguage),
  new JSONFixture(languages.JavaLanguage),
  new JSONFixture(languages.GoLanguage),
  new JSONFixture(languages.ElmLanguage),
  new JSONFixture(languages.Swift3Language, "swift3"),
  new JSONFixture(languages.Swift4Language, "swift4"),
  new JSONFixture(languages.TypeScriptLanguage),
  new JSONSchemaJSONFixture(languages.GoLanguage),
  new JSONSchemaFixture(languages.CSharpLanguage),
  new JSONSchemaFixture(languages.NewCSharpLanguage),
  new JSONSchemaFixture(languages.JavaLanguage),
  new JSONSchemaFixture(languages.GoLanguage),
  new JSONSchemaFixture(languages.Swift3ClassesLanguage, "schema-swift3"),
  new JSONSchemaFixture(languages.Swift4ClassesLanguage, "schema-swift4"),
  new JSONSchemaFixture(languages.TypeScriptLanguage)
];
