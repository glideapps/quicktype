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
  Sample,
  samplesFromSources,
  samplesFromPaths,
  testsInDir
} from "./utils";
import * as languages from "./languages";
import { RendererOptions } from "../dist/quicktype";
import { panic } from "../dist/Support";

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
  ): { priority: Sample[]; others: Sample[] };

  abstract runWithSample(
    sample: Sample,
    index: number,
    total: number
  ): Promise<void>;

  getRunDirectory(): string {
    return `test/runs/${this.name}-${randomBytes(3).toString("hex")}`;
  }

  printRunMessage(
    sample: Sample,
    index: number,
    total: number,
    cwd: string,
    shouldSkip: boolean
  ): void {
    console.error(
      `*`,
      chalk.dim(`[${index + 1}/${total}]`),
      chalk.magenta(this.name),
      JSON.stringify(sample.additionalRendererOptions),
      path.join(cwd, chalk.cyan(path.basename(sample.path))),
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

  abstract shouldSkipTest(sample: Sample): boolean;
  abstract async runQuicktype(
    filename: string,
    additionalRendererOptions: RendererOptions
  ): Promise<void>;
  abstract async test(
    filename: string,
    additionalRendererOptions: RendererOptions,
    additionalFiles: string[]
  ): Promise<void>;

  additionalFiles(sample: Sample): string[] {
    return [];
  }

  async runWithSample(sample: Sample, index: number, total: number) {
    const cwd = this.getRunDirectory();
    let sampleFile = path.basename(sample.path);
    let shouldSkip = this.shouldSkipTest(sample);
    const additionalFiles = this.additionalFiles(sample);

    this.printRunMessage(sample, index, total, cwd, shouldSkip);

    if (shouldSkip) {
      return;
    }

    shell.cp("-R", this.language.base, cwd);
    shell.cp.apply(null, _.concat(sample.path, additionalFiles, cwd));

    await inDir(cwd, async () => {
      await this.runQuicktype(sampleFile, sample.additionalRendererOptions);

      try {
        await this.test(
          sampleFile,
          sample.additionalRendererOptions,
          additionalFiles
        );
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

  async runQuicktype(
    sample: string,
    additionalRendererOptions: RendererOptions
  ): Promise<void> {
    // FIXME: add options
    await quicktypeForLanguage(
      this.language,
      sample,
      "json",
      additionalRendererOptions
    );
  }

  async test(
    filename: string,
    additionalRendererOptions: RendererOptions,
    additionalFiles: string[]
  ): Promise<void> {
    if (this.language.compileCommand) {
      exec(this.language.compileCommand);
    }
    compareJsonFileToJson({
      expectedFile: filename,
      given: { command: this.language.runCommand(filename) },
      strict: false,
      allowMissingNull: this.language.allowMissingNull
    });

    if (this.language.diffViaSchema) {
      debug("* Diffing with code generated via JSON Schema");
      // Make a schema
      await quicktype({
        src: [filename],
        lang: "schema",
        out: "schema.json",
        topLevel: this.language.topLevel,
        rendererOptions: {}
      });
      // Quicktype from the schema and compare to expected code
      shell.mv(this.language.output, `${this.language.output}.expected`);
      await quicktypeForLanguage(
        this.language,
        "schema.json",
        "schema",
        additionalRendererOptions
      );

      // Compare fixture.output to fixture.output.expected
      exec(
        `diff -Naur ${this.language.output}.expected ${this.language
          .output} > /dev/null 2>&1`
      );
    }
  }

  shouldSkipTest(sample: Sample): boolean {
    if (fs.statSync(sample.path).size > 32 * 1024 * 1024) {
      return true;
    }
    return _.includes(this.language.skipJSON, path.basename(sample.path));
  }

  getSamples(sources: string[]): { priority: Sample[]; others: Sample[] } {
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

    const combinationsInput = _.find(prioritySamples, p =>
      p.endsWith("/priority/combinations.json")
    );
    if (!combinationsInput) {
      return failWith(
        "priority/combinations.json sample not found",
        prioritySamples
      );
    }
    if (sources.length === 0) {
      const quickTestSamples = _.map(
        this.language.quickTestRendererOptions,
        ro => ({ path: combinationsInput, additionalRendererOptions: ro })
      );
      priority = quickTestSamples.concat(priority);
    }

    if (IS_CI && !IS_PR && !IS_BLESSED) {
      // Run only priority sources on low-priority CI branches
      others = [];
    } else if (IS_CI) {
      // On CI, we run a maximum number of test samples. First we test
      // the priority samples to fail faster, then we continue testing
      // until testMax with random sources.
      const testMax = 100;
      others = _.chain(samplesFromPaths(miscSamples))
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
        return panic("This must not be called!");
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
      skipSchema: [],
      rendererOptions: {},
      quickTestRendererOptions: []
    };
    super(schemaLanguage);
    this.runLanguage = language;
    this.name = `schema-json-${language.name}`;
  }

  runForName(name: string): boolean {
    return this.name === name || name === "schema-json";
  }

  async test(
    filename: string,
    additionalRendererOptions: RendererOptions,
    additionalFiles: string[]
  ) {
    let input = JSON.parse(fs.readFileSync(filename, "utf8"));
    let schema = JSON.parse(fs.readFileSync("schema.json", "utf8"));

    let ajv = new Ajv();
    let valid = ajv.validate(schema, input);
    if (!valid) {
      failWith("Generated schema does not validate input JSON.", {
        filename
      });
    }

    // Generate code from the schema
    await quicktypeForLanguage(
      this.runLanguage,
      "schema.json",
      "schema",
      additionalRendererOptions
    );

    // Parse the sample with the code generated from its schema, and compare to the sample
    compareJsonFileToJson({
      expectedFile: filename,
      given: { command: this.runLanguage.runCommand(filename) },
      strict: false,
      allowMissingNull: this.runLanguage.allowMissingNull
    });

    // Generate a schema from the schema, making sure the schemas are the same
    let schemaSchema = "schema-from-schema.json";
    await quicktype({
      src: ["schema.json"],
      srcLang: "schema",
      lang: "schema",
      topLevel: "schema",
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

  getSamples(sources: string[]): { priority: Sample[]; others: Sample[] } {
    const prioritySamples = testsInDir("test/inputs/schema/", "schema");
    return samplesFromSources(sources, prioritySamples, [], "schema");
  }

  shouldSkipTest(sample: Sample): boolean {
    return _.includes(this.language.skipSchema, path.basename(sample.path));
  }

  async runQuicktype(
    filename: string,
    additionalRendererOptions: RendererOptions
  ): Promise<void> {
    await quicktypeForLanguage(
      this.language,
      filename,
      "schema",
      additionalRendererOptions
    );
  }

  additionalFiles(sample: Sample): string[] {
    const base = path.join(
      path.dirname(sample.path),
      path.basename(sample.path, ".schema")
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

  async test(
    sample: string,
    additionalRendererOptions: RendererOptions,
    jsonFiles: string[]
  ): Promise<void> {
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
  new JSONFixture(languages.JavaLanguage),
  new JSONFixture(languages.GoLanguage),
  new JSONFixture(languages.CPlusPlusLanguage),
  new JSONFixture(languages.ElmLanguage),
  new JSONFixture(languages.Swift3Language, "swift3"),
  new JSONFixture(languages.Swift4Language, "swift4"),
  new JSONFixture(languages.TypeScriptLanguage),
  new JSONSchemaJSONFixture(languages.CSharpLanguage),
  new JSONSchemaFixture(languages.CSharpLanguage),
  new JSONSchemaFixture(languages.JavaLanguage),
  new JSONSchemaFixture(languages.GoLanguage),
  new JSONSchemaFixture(languages.CPlusPlusIndirectionLanguage),
  new JSONSchemaFixture(languages.Swift3ClassesLanguage, "schema-swift3"),
  new JSONSchemaFixture(languages.Swift4ClassesLanguage, "schema-swift4"),
  new JSONSchemaFixture(languages.TypeScriptLanguage)
];
