"use strict";

import * as _ from "lodash";
import * as path from "path";
import * as fs from "fs";
import { randomBytes } from "crypto";
import * as shell from "shelljs";

const Ajv = require("ajv");

import {
  compareJsonFileToJson,
  debug,
  exec,
  execAsync,
  failWith,
  inDir,
  quicktype,
  quicktypeForLanguage,
  Sample,
  samplesFromSources,
  testsInDir
} from "./utils";
import * as languages from "./languages";
import { RendererOptions } from "../dist";
import { panic } from "../dist/Support";
import { isDateTime } from "../dist/DateTime";

const chalk = require("chalk");
const timeout = require("promise-timeout").timeout;

const OUTPUT_DIR = process.env.OUTPUT_DIR;
const ONLY_OUTPUT = process.env.ONLY_OUTPUT !== undefined;

const MAX_TEST_RUNTIME_MS = 30 * 60 * 1000;

function pathWithoutExtension(fullPath: string, extension: string): string {
  return path.join(path.dirname(fullPath), path.basename(fullPath, extension));
}

function jsonTestFiles(base: string): string[] {
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
  return jsonFiles;
}

export abstract class Fixture {
  abstract name: string;

  constructor(public language: languages.Language) {}

  runForName(name: string): boolean {
    return this.name === name;
  }

  async setup(): Promise<void> {
    return;
  }

  abstract getSamples(sources: string[]): { priority: Sample[]; others: Sample[] };

  abstract runWithSample(sample: Sample, index: number, total: number): Promise<void>;

  getRunDirectory(): string {
    return `test/runs/${this.name}-${randomBytes(3).toString("hex")}`;
  }

  runMessageStart(sample: Sample, index: number, total: number, cwd: string, shouldSkip: boolean): string {
    const rendererOptions = _.map(sample.additionalRendererOptions, (v, k) => `${k}: ${v}`).join(", ");
    const message = [
      `*`,
      chalk.dim(`[${index + 1}/${total}]`),
      chalk.magenta(this.name) + chalk.dim(`(${rendererOptions})`),
      path.join(cwd, chalk.cyan(path.basename(sample.path))),
      shouldSkip ? chalk.red("SKIP") : ""
    ].join(" ");
    console.time(message);
    return message;
  }

  runMessageEnd(message: string) {
    console.timeEnd(message);
  }
}

abstract class LanguageFixture extends Fixture {
  constructor(language: languages.Language) {
    super(language);
  }

  async setup() {
    const setupCommand = this.language.setupCommand;
    if (!setupCommand || ONLY_OUTPUT) {
      return;
    }

    console.error(`* Setting up`, chalk.magenta(this.name), `fixture`);

    await inDir(this.language.base, async () => {
      await execAsync(setupCommand);
    });
  }

  abstract shouldSkipTest(sample: Sample): boolean;
  abstract async runQuicktype(filename: string, additionalRendererOptions: RendererOptions): Promise<void>;
  abstract async test(
    filename: string,
    additionalRendererOptions: RendererOptions,
    additionalFiles: string[]
  ): Promise<void>;

  additionalFiles(_sample: Sample): string[] {
    return [];
  }

  async runWithSample(sample: Sample, index: number, total: number) {
    const cwd = this.getRunDirectory();
    let sampleFile = path.basename(sample.path);
    let shouldSkip = this.shouldSkipTest(sample);
    const additionalFiles = this.additionalFiles(sample);

    const message = this.runMessageStart(sample, index, total, cwd, shouldSkip);

    if (shouldSkip) {
      return;
    }

    shell.cp("-R", this.language.base, cwd);
    shell.cp.apply(null, _.concat(sample.path, additionalFiles, cwd));

    await inDir(cwd, async () => {
      await this.runQuicktype(sampleFile, sample.additionalRendererOptions);

      if (ONLY_OUTPUT) {
        return;
      }

      try {
        await timeout(
          this.test(sampleFile, sample.additionalRendererOptions, additionalFiles),
          MAX_TEST_RUNTIME_MS
        );
      } catch (e) {
        failWith("Fixture threw an exception", { error: e, sample });
      }
    });

    // FIXME: This is an ugly hack to exclude Java, which has multiple
    // output files.  We have to support that eventually.
    if (sample.saveOutput && OUTPUT_DIR !== undefined && this.language.output.indexOf("/") < 0) {
      const outputDir = path.join(
        OUTPUT_DIR,
        this.language.name,
        path.dirname(sample.path),
        path.basename(sample.path, path.extname(sample.path))
      );
      try {
        shell.mkdir("-p", outputDir);
      } catch (e) {
        console.error(`Error creating directory "${outputDir}" - probably another thread created it`);
      }
      shell.cp(path.join(cwd, this.language.output), outputDir);
    }

    shell.rm("-rf", cwd);

    this.runMessageEnd(message);
  }
}

class JSONFixture extends LanguageFixture {
  constructor(language: languages.Language, public name: string = language.name) {
    super(language);
  }

  runForName(name: string): boolean {
    return this.name === name || name === "json";
  }

  async runQuicktype(sample: string, additionalRendererOptions: RendererOptions): Promise<void> {
    // FIXME: add options
    await quicktypeForLanguage(this.language, sample, "json", true, additionalRendererOptions);
  }

  async test(
    filename: string,
    additionalRendererOptions: RendererOptions,
    _additionalFiles: string[]
  ): Promise<void> {
    if (this.language.compileCommand) {
      await execAsync(this.language.compileCommand);
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
      await quicktypeForLanguage(this.language, "schema.json", "schema", true, additionalRendererOptions);

      // Compare fixture.output to fixture.output.expected
      exec(`diff -Naur ${this.language.output}.expected ${this.language.output} > /dev/null 2>&1`);
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

    const miscSamples = this.language.skipMiscJSON ? [] : testsInDir("test/inputs/json/misc", "json");

    let { priority, others } = samplesFromSources(sources, prioritySamples, miscSamples, "json");

    const combinationsInput = _.find(prioritySamples, p => p.endsWith("/priority/combinations.json"));
    if (!combinationsInput) {
      return failWith("priority/combinations.json sample not found", prioritySamples);
    }
    if (sources.length === 0 && !ONLY_OUTPUT) {
      const quickTestSamples = _.map(this.language.quickTestRendererOptions, ro => ({
        path: combinationsInput,
        additionalRendererOptions: ro,
        saveOutput: false
      }));
      priority = quickTestSamples.concat(priority);
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
  private readonly runLanguage: languages.Language;

  constructor(language: languages.Language) {
    const schemaLanguage: languages.Language = {
      name: "schema",
      base: language.base,
      setupCommand: language.setupCommand,
      runCommand: (_sample: string) => {
        return panic("This must not be called!");
      },
      diffViaSchema: false,
      allowMissingNull: language.allowMissingNull,
      output: "schema.json",
      topLevel: "schema",
      skipJSON: [
        "blns-object.json", // AJV refuses to even "compile" the schema we generate
        "31189.json", // same here
        "ed095.json" // same here on Travis
      ],
      skipMiscJSON: false,
      skipSchema: [],
      rendererOptions: {},
      quickTestRendererOptions: [],
      sourceFiles: language.sourceFiles
    };
    super(schemaLanguage);
    this.runLanguage = language;
    this.name = `schema-json-${language.name}`;
  }

  runForName(name: string): boolean {
    return this.name === name || name === "schema-json";
  }

  async test(filename: string, additionalRendererOptions: RendererOptions, _additionalFiles: string[]) {
    let input = JSON.parse(fs.readFileSync(filename, "utf8"));
    let schema = JSON.parse(fs.readFileSync("schema.json", "utf8"));

    let ajv = new Ajv({ format: "full" });
    // Make Ajv's date-time compatible with what we recognize
    ajv.addFormat("date-time", isDateTime);
    let valid = ajv.validate(schema, input);
    if (!valid) {
      failWith("Generated schema does not validate input JSON.", {
        filename
      });
    }

    // Generate code from the schema
    await quicktypeForLanguage(this.runLanguage, "schema.json", "schema", false, additionalRendererOptions);

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
  constructor(language: languages.Language, readonly name: string = `schema-${language.name}`) {
    super(language);
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

  async runQuicktype(filename: string, additionalRendererOptions: RendererOptions): Promise<void> {
    await quicktypeForLanguage(this.language, filename, "schema", false, additionalRendererOptions);
  }

  additionalFiles(sample: Sample): string[] {
    return jsonTestFiles(pathWithoutExtension(sample.path, ".schema"));
  }

  async test(
    _sample: string,
    _additionalRendererOptions: RendererOptions,
    jsonFiles: string[]
  ): Promise<void> {
    if (this.language.compileCommand) {
      await execAsync(this.language.compileCommand);
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

function graphQLSchemaFilename(baseName: string): string {
  const baseMatch = baseName.match(/(.*\D)\d+$/);
  if (baseMatch === null) {
    return failWith("GraphQL test filename does not correspond to naming schema", { baseName });
  }
  return baseMatch[1] + ".gqlschema";
}

class GraphQLFixture extends LanguageFixture {
  constructor(
    language: languages.Language,
    private readonly _onlyExactName: boolean = false,
    readonly name: string = `graphql-${language.name}`
  ) {
    super(language);
  }

  runForName(name: string): boolean {
    return this.name === name || (!this._onlyExactName && name === "graphql");
  }

  getSamples(sources: string[]): { priority: Sample[]; others: Sample[] } {
    const prioritySamples = testsInDir("test/inputs/graphql/", "graphql");
    return samplesFromSources(sources, prioritySamples, [], "graphql");
  }

  shouldSkipTest(_sample: Sample): boolean {
    return false;
  }

  async runQuicktype(filename: string, additionalRendererOptions: RendererOptions): Promise<void> {
    const baseName = pathWithoutExtension(filename, ".graphql");
    const schemaFilename = graphQLSchemaFilename(baseName);
    await quicktypeForLanguage(
      this.language,
      filename,
      "graphql",
      false,
      additionalRendererOptions,
      schemaFilename
    );
  }

  additionalFiles(sample: Sample): string[] {
    const baseName = pathWithoutExtension(sample.path, ".graphql");
    return jsonTestFiles(baseName).concat(graphQLSchemaFilename(baseName));
  }

  async test(
    _filename: string,
    _additionalRendererOptions: RendererOptions,
    additionalFiles: string[]
  ): Promise<void> {
    if (this.language.compileCommand) {
      await execAsync(this.language.compileCommand);
    }
    for (const fn of additionalFiles) {
      if (!fn.endsWith(".json")) {
        continue;
      }
      const jsonBase = path.basename(fn);
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
  new JSONFixture(languages.RustLanguage),
  new JSONFixture(languages.RubyLanguage),
  new JSONFixture(languages.ElmLanguage),
  new JSONFixture(languages.SwiftLanguage),
  new JSONFixture(languages.ObjectiveCLanguage),
  new JSONFixture(languages.TypeScriptLanguage),
  new JSONFixture(languages.FlowLanguage),
  new JSONFixture(languages.JavaScriptLanguage),
  new JSONSchemaJSONFixture(languages.CSharpLanguage),
  new JSONSchemaFixture(languages.CSharpLanguage),
  new JSONSchemaFixture(languages.JavaLanguage),
  new JSONSchemaFixture(languages.GoLanguage),
  new JSONSchemaFixture(languages.CPlusPlusLanguage),
  new JSONSchemaFixture(languages.RustLanguage),
  new JSONSchemaFixture(languages.ElmLanguage),
  new JSONSchemaFixture(languages.SwiftLanguage),
  new JSONSchemaFixture(languages.TypeScriptLanguage),
  new JSONSchemaFixture(languages.FlowLanguage),
  new JSONSchemaFixture(languages.JavaScriptLanguage),
  new GraphQLFixture(languages.CSharpLanguage),
  new GraphQLFixture(languages.JavaLanguage),
  new GraphQLFixture(languages.GoLanguage),
  new GraphQLFixture(languages.CPlusPlusLanguage),
  new GraphQLFixture(languages.SwiftLanguage),
  new GraphQLFixture(languages.ObjectiveCLanguage, true),
  new GraphQLFixture(languages.TypeScriptLanguage),
  new GraphQLFixture(languages.FlowLanguage),
  new GraphQLFixture(languages.JavaScriptLanguage)
];
