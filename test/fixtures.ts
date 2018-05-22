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
import { RendererOptions } from "../dist/quicktype-core/Run";
import { mustNotBeCalled } from "../dist/quicktype-core/support/Support";
import { isDateTime } from "../dist/quicktype-core/DateTime";

const chalk = require("chalk");
const timeout = require("promise-timeout").timeout;

const OUTPUT_DIR = process.env.OUTPUT_DIR;
const ONLY_OUTPUT = process.env.ONLY_OUTPUT !== undefined;

const MAX_TEST_RUNTIME_MS = 30 * 60 * 1000;

function pathWithoutExtension(fullPath: string, extension: string): string {
  return path.join(path.dirname(fullPath), path.basename(fullPath, extension));
}

function additionalTestFiles(base: string, extension: string): string[] {
  const additionalFiles: string[] = [];
  let fn = `${base}.${extension}`;
  if (fs.existsSync(fn)) {
    additionalFiles.push(fn);
  }
  let i = 1;
  for (;;) {
    fn = `${base}.${i.toString()}.${extension}`;
    if (fs.existsSync(fn)) {
      additionalFiles.push(fn);
    } else {
      break;
    }
    i++;
  }
  return additionalFiles;
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

    if (
      this.language.diffViaSchema &&
      !_.includes(this.language.skipDiffViaSchema, path.basename(filename))
    ) {
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

// This fixture tests generating code for language X from JSON,
// then generating code for Y from the code for X, making sure
// that the resulting code for Y accepts the JSON by running it
// on the original JSON.
class JSONToXToYFixture extends JSONFixture {
  private readonly runLanguage: languages.Language;

  constructor(
    private readonly _fixturePrefix: string,
    languageXName: string,
    languageXOutputFilename: string,
    rendererOptions: RendererOptions,
    skipJSON: string[],
    language: languages.Language
  ) {
    super({
      name: languageXName,
      base: language.base,
      setupCommand: language.setupCommand,
      runCommand: (_sample: string) => mustNotBeCalled(),
      diffViaSchema: false,
      skipDiffViaSchema: [],
      allowMissingNull: language.allowMissingNull,
      output: languageXOutputFilename,
      topLevel: "TopLevel",
      skipJSON,
      skipMiscJSON: false,
      skipSchema: [],
      rendererOptions,
      quickTestRendererOptions: [],
      sourceFiles: language.sourceFiles
    });
    this.runLanguage = language;
    this.name = `${this._fixturePrefix}-${language.name}`;
  }

  runForName(name: string): boolean {
    return this.name === name || name === this._fixturePrefix;
  }

  async test(filename: string, additionalRendererOptions: RendererOptions, _additionalFiles: string[]) {
    // Generate code for Y from X
    await quicktypeForLanguage(
      this.runLanguage,
      this.language.output,
      this.language.name,
      false,
      additionalRendererOptions
    );

    // Parse the sample with the code generated from its schema, and compare to the sample
    compareJsonFileToJson({
      expectedFile: filename,
      given: { command: this.runLanguage.runCommand(filename) },
      strict: false,
      allowMissingNull: this.runLanguage.allowMissingNull
    });
  }

  shouldSkipTest(sample: Sample): boolean {
    if (super.shouldSkipTest(sample)) return true;
    return _.includes(this.runLanguage.skipJSON, path.basename(sample.path));
  }
}

// This tests generating Schema from JSON, and then generating
// target code from that Schema.  The target code is then run on
// the original JSON.  Also generating a Schema from the Schema
// and testing that it's the same as the original Schema.
class JSONSchemaJSONFixture extends JSONToXToYFixture {
  constructor(language: languages.Language) {
    const skipJSON = [
      "blns-object.json", // AJV refuses to even "compile" the schema we generate
      "31189.json", // same here
      "ed095.json" // same here on Travis
    ];
    super("schema-json", "schema", "schema.json", {}, skipJSON, language);
  }

  async test(
    filename: string,
    additionalRendererOptions: RendererOptions,
    additionalFiles: string[]
  ): Promise<void> {
    let input = JSON.parse(fs.readFileSync(filename, "utf8"));
    let schema = JSON.parse(fs.readFileSync(this.language.output, "utf8"));

    let ajv = new Ajv({ format: "full" });
    // Make Ajv's date-time compatible with what we recognize
    ajv.addFormat("date-time", isDateTime);
    let valid = ajv.validate(schema, input);
    if (!valid) {
      failWith("Generated schema does not validate input JSON.", {
        filename
      });
    }

    await super.test(filename, additionalRendererOptions, additionalFiles);

    // Generate a schema from the schema, making sure the schemas are the same
    // FIXME: We could move this to the superclass and test it for all JSON->X->Y
    let schemaSchema = "schema-from-schema.json";
    await quicktype({
      src: [this.language.output],
      srcLang: this.language.name,
      lang: this.language.name,
      topLevel: this.language.topLevel,
      out: schemaSchema,
      rendererOptions: {}
    });
    compareJsonFileToJson({
      expectedFile: this.language.output,
      given: { file: schemaSchema },
      strict: true
    });
  }
}

// These are all inputs where the top-level type is not directly
// converted to TypeScript, mostly arrays.
const skipTypeScriptTests = [
  "no-classes.json",
  "optional-union.json",
  "pokedex.json", // Enums are screwed up: https://github.com/YousefED/typescript-json-schema/issues/186
  "github-events.json",
  "bug855-short.json",
  "00c36.json",
  "010b1.json",
  "050b0.json",
  "06bee.json",
  "07c75.json",
  "0a91a.json",
  "10be4.json",
  "13d8d.json",
  "176f1.json", // Enum screwed up
  "1a7f5.json",
  "262f0.json", // Enum screwed up
  "2df80.json",
  "32d5c.json",
  "33d2e.json", // Enum screwed up
  "34702.json", // Enum screwed up
  "3536b.json",
  "3e9a3.json", // duplicate top-level type: https://github.com/quicktype/quicktype/issues/726
  "3f1ce.json", // Enum screwed up
  "43970.json",
  "570ec.json",
  "5eae5.json",
  "65dec.json", // duplicate top-level type
  "66121.json",
  "6dec6.json", // Enum screwed up
  "6eb00.json",
  "77392.json",
  "7f568.json",
  "7eb30.json", // duplicate top-level type
  "7fbfb.json",
  "9847b.json",
  "996bd.json",
  "9a503.json",
  "9eed5.json",
  "a45b0.json",
  "ab0d1.json",
  "ad8be.json",
  "ae9ca.json", // Enum screwed up
  "af2d1.json", // Enum screwed up
  "b4865.json",
  "c8c7e.json",
  "cb0cc.json", // Enum screwed up
  "cda6c.json",
  "dbfb3.json", // Enum screwed up
  "e2a58.json",
  "e53b5.json",
  "e8a0b.json",
  "e8b04.json",
  "ed095.json", // top-level is a map
  "f3139.json",
  "f3edf.json",
  "f466a.json"
];

class JSONTypeScriptFixture extends JSONToXToYFixture {
  constructor(language: languages.Language) {
    super("json-ts", "ts", "typescript.ts", { "just-types": "true" }, [], language);
  }

  shouldSkipTest(sample: Sample): boolean {
    if (super.shouldSkipTest(sample)) return true;
    return skipTypeScriptTests.indexOf(path.basename(sample.path)) >= 0;
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
    const baseName = pathWithoutExtension(sample.path, ".schema");
    return additionalTestFiles(baseName, "json").concat(additionalTestFiles(baseName, "ref"));
  }

  async test(
    _sample: string,
    _additionalRendererOptions: RendererOptions,
    additionalFiles: string[]
  ): Promise<void> {
    if (this.language.compileCommand) {
      await execAsync(this.language.compileCommand);
    }
    for (const filename of additionalFiles) {
      if (!filename.endsWith(".json")) continue;

      const jsonBase = path.basename(filename);
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
    return additionalTestFiles(baseName, "json").concat(graphQLSchemaFilename(baseName));
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
  new JSONFixture(languages.KotlinLanguage),
  new JSONSchemaJSONFixture(languages.CSharpLanguage),
  new JSONTypeScriptFixture(languages.CSharpLanguage),
  new JSONSchemaFixture(languages.CSharpLanguage),
  new JSONSchemaFixture(languages.JavaLanguage),
  new JSONSchemaFixture(languages.GoLanguage),
  new JSONSchemaFixture(languages.CPlusPlusLanguage),
  new JSONSchemaFixture(languages.RustLanguage),
  new JSONSchemaFixture(languages.RubyLanguage),
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
