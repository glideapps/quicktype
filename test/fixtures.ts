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
    testsInDir,
    ComparisonArgs,
    mkdirs,
    callAndExpectFailure
} from "./utils";
import * as languages from "./languages";
import { RendererOptions } from "quicktype-core";
import { mustNotHappen, defined } from "../packages/quicktype-core/dist/support/Support";
import { DefaultDateTimeRecognizer } from "../packages/quicktype-core/dist/DateTime";

import chalk from "chalk";
const timeout = require("promise-timeout").timeout;

const OUTPUT_DIR = process.env.OUTPUT_DIR;
const ONLY_OUTPUT = process.env.ONLY_OUTPUT !== undefined;

const MAX_TEST_RUNTIME_MS = 30 * 60 * 1000;

/**
 * These are tests where we have stringified integers that might be serialized
 * back as integers, which happens in heterogenous arrays such as ["123", 456].
 */
const testsWithStringifiedIntegers = ["nst-test-suite.json", "kitchen-sink.json"];

function allowStringifiedIntegers(language: languages.Language, test: string): boolean {
    if (language.features.indexOf("integer-string") < 0) return false;
    return testsWithStringifiedIntegers.indexOf(path.basename(test)) >= 0;
}

function pathWithoutExtension(fullPath: string, extension: string): string {
    return path.join(path.dirname(fullPath), path.basename(fullPath, extension));
}

function additionalTestFiles(base: string, extension: string, features: string[] = []): string[] {
    const additionalFiles: string[] = [];
    function tryAdd(filename: string): boolean {
        if (!fs.existsSync(filename)) return false;
        additionalFiles.push(filename);
        return true;
    }

    let fn = `${base}.${extension}`;
    tryAdd(fn);
    let i = 1;
    let found: boolean;
    do {
        found = false;

        fn = `${base}.${i.toString()}.${extension}`;
        found = tryAdd(fn) || found;

        for (const feature of features) {
            found = tryAdd(`${base}.${i.toString()}.fail.${feature}.${extension}`) || found;
        }
        found = tryAdd(`${base}.${i.toString()}.fail.${extension}`) || found;

        i++;
    } while (found);
    return additionalFiles;
}

function runEnvForLanguage(additionalRendererOptions: RendererOptions): NodeJS.ProcessEnv {
    const newEnv = Object.assign({}, process.env);
    for (const o of Object.getOwnPropertyNames(additionalRendererOptions)) {
        newEnv["QUICKTYPE_" + o.toUpperCase().replace("-", "_")] = additionalRendererOptions[o].toString();
    }
    return newEnv;
}

function comparisonArgs(
    language: languages.Language,
    inputFilename: string,
    expectedFilename: string,
    additionalRendererOptions: RendererOptions
): ComparisonArgs {
    return {
        expectedFile: expectedFilename,
        given: {
            command: defined(language.runCommand)(inputFilename),
            env: runEnvForLanguage(additionalRendererOptions)
        },
        strict: false,
        allowMissingNull: language.allowMissingNull,
        allowStringifiedIntegers: allowStringifiedIntegers(language, expectedFilename)
    };
}

const timeMap = new Map<string, number>();

function timeStart(message: string): void {
    timeMap.set(message, Date.now());
}

function timeEnd(message: string, suffix: string): void {
    const start = timeMap.get(message);
    const fullMessage = message + suffix;
    if (start === undefined) {
        console.log(fullMessage + ": " + chalk.red("UNKNOWN TIMING"));
        return;
    }
    const diff = Date.now() - start;
    console.log(fullMessage + `: ${diff} ms`);
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
        const messageParts = [
            `*`,
            chalk.dim(`[${index + 1}/${total}]`),
            chalk.magenta(this.name) + chalk.dim(`(${rendererOptions})`),
            path.join(cwd, chalk.cyan(path.basename(sample.path)))
        ];
        if (shouldSkip) {
            messageParts.push(chalk.red("SKIP"));
        }
        const message = messageParts.join(" ");
        timeStart(message);
        return message;
    }

    runMessageEnd(message: string, numFiles: number) {
        const numFilesString = ` (${numFiles} files)`;
        const suffix = numFiles <= 0 ? chalk.red(numFilesString) : numFiles > 1 ? chalk.green(numFilesString) : "";
        timeEnd(message, suffix);
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
    abstract runQuicktype(filename: string, additionalRendererOptions: RendererOptions): Promise<void>;
    abstract test(
        filename: string,
        additionalRendererOptions: RendererOptions,
        additionalFiles: string[]
    ): Promise<number>;

    additionalFiles(_sample: Sample): string[] {
        return [];
    }

    async runWithSample(sample: Sample, index: number, total: number) {
        const cwd = this.getRunDirectory();
        const sampleFile = path.resolve(sample.path);
        const shouldSkip = this.shouldSkipTest(sample);
        const additionalFiles = this.additionalFiles(sample).map(p => path.resolve(p));

        const message = this.runMessageStart(sample, index, total, cwd, shouldSkip);

        if (shouldSkip) {
            return;
        }

        shell.cp("-R", this.language.base, cwd);

        if (this.language.copyInput) {
            shell.cp(sampleFile, cwd);
        }

        let numFiles = -1;
        await inDir(cwd, async () => {
            await this.runQuicktype(sampleFile, sample.additionalRendererOptions);

            if (ONLY_OUTPUT) {
                return;
            }

            try {
                numFiles = await timeout(
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
            mkdirs(outputDir);
            shell.cp(path.join(cwd, this.language.output), outputDir);
        }

        // Clean up the run directory if we're in CI.
        if (process.env.CI !== undefined) {
            shell.rm("-rf", cwd);
        }

        this.runMessageEnd(message, numFiles);
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
    ): Promise<number> {
        if (this.language.compileCommand) {
            await execAsync(this.language.compileCommand);
        }
        if (this.language.runCommand === undefined) return 0;

        compareJsonFileToJson(comparisonArgs(this.language, filename, filename, additionalRendererOptions));

        if (this.language.diffViaSchema && !_.includes(this.language.skipDiffViaSchema, path.basename(filename))) {
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
            exec(`diff -Naur ${this.language.output}.expected ${this.language.output} > /dev/null 2>&1`, undefined);
        }

        return 1;
    }

    shouldSkipTest(sample: Sample): boolean {
        if (fs.statSync(sample.path).size > 32 * 1024 * 1024) {
            return true;
        }
        if (this.language.includeJSON !== undefined) {
            return !_.includes(this.language.includeJSON, path.basename(sample.path));
        }
        if (this.language.skipJSON !== undefined) {
            return _.includes(this.language.skipJSON, path.basename(sample.path));
        }
        return false;
    }

    getSamples(sources: string[]): { priority: Sample[]; others: Sample[] } {
        // FIXME: this should only run once
        const prioritySamples = _.concat(
            testsInDir("test/inputs/json/priority", "json"),
            testsInDir("test/inputs/json/samples", "json")
        );

        const skipMiscJSON = process.env.QUICKTEST !== undefined || this.language.skipMiscJSON;
        const miscSamples = skipMiscJSON ? [] : testsInDir("test/inputs/json/misc", "json");

        let { priority, others } = samplesFromSources(sources, prioritySamples, miscSamples, "json");

        const combinationInputs = _.map([1, 2, 3, 4], n =>
            _.find(prioritySamples, p => p.endsWith(`/priority/combinations${n}.json`))
        );
        if (combinationInputs.some(p => p === undefined)) {
            return failWith("priority/combinations[1234].json samples not found", prioritySamples);
        }
        if (sources.length === 0 && !ONLY_OUTPUT) {
            const quickTestSamples = _.chain(this.language.quickTestRendererOptions)
                .flatMap(qt => {
                    if (Array.isArray(qt)) {
                        const [filename, ro] = qt;
                        const input = _.find(([] as string[]).concat(prioritySamples, miscSamples), p =>
                            p.endsWith(`/${filename}`)
                        );
                        if (input === undefined) {
                            return failWith(`quick-test sample ${filename} not found`, qt);
                        }
                        return [
                            {
                                path: input,
                                additionalRendererOptions: ro,
                                saveOutput: false
                            }
                        ];
                    } else {
                        return _.map(combinationInputs, p => ({
                            path: defined(p),
                            additionalRendererOptions: qt,
                            saveOutput: false
                        }));
                    }
                })
                .value();
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
            runCommand: mustNotHappen,
            diffViaSchema: false,
            skipDiffViaSchema: [],
            allowMissingNull: language.allowMissingNull,
            features: language.features,
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

    async test(
        filename: string,
        additionalRendererOptions: RendererOptions,
        _additionalFiles: string[]
    ): Promise<number> {
        // Generate code for Y from X
        await quicktypeForLanguage(
            this.runLanguage,
            this.language.output,
            this.language.name,
            false,
            additionalRendererOptions
        );

        // Parse the sample with the code generated from its schema, and compare to the sample
        compareJsonFileToJson(comparisonArgs(this.runLanguage, filename, filename, additionalRendererOptions));

        return 1;
    }

    shouldSkipTest(sample: Sample): boolean {
        if (super.shouldSkipTest(sample)) return true;
        return _.includes(this.runLanguage.skipJSON, path.basename(sample.path));
    }
}

const dateTimeRecognizer = new DefaultDateTimeRecognizer();

// This tests generating Schema from JSON, and then generating
// target code from that Schema.  The target code is then run on
// the original JSON.  Also generating a Schema from the Schema
// and testing that it's the same as the original Schema.
class JSONSchemaJSONFixture extends JSONToXToYFixture {
    constructor(language: languages.Language) {
        const skipJSON = [
            "blns-object.json", // AJV refuses to even "compile" the schema we generate
            "31189.json", // same here
            "437e7.json", // uri/string confusion
            "ed095.json" // same here on Travis
        ];
        super("schema-json", "schema", "schema.json", {}, skipJSON, language);
    }

    async test(
        filename: string,
        additionalRendererOptions: RendererOptions,
        additionalFiles: string[]
    ): Promise<number> {
        let input = JSON.parse(fs.readFileSync(filename, "utf8"));
        let schema = JSON.parse(fs.readFileSync(this.language.output, "utf8"));

        let ajv = new Ajv({ format: "full", unknownFormats: ["integer", "boolean"] });
        // Make Ajv's date-time compatible with what we recognize.  All non-standard
        // JSON formats that we use for transformed type kinds must be registered here
        // with a validation function.
        // FIXME: Unify this with what's in StringTypes.ts.
        ajv.addFormat("date-time", (s: string) => dateTimeRecognizer.isDateTime(s));
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

        return 1;
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
    "bug863.json",
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

// This fixture tests generating code from JSON Schema.
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
        return additionalTestFiles(baseName, "json", this.language.features);
    }

    async test(
        _sample: string,
        additionalRendererOptions: RendererOptions,
        additionalFiles: string[]
    ): Promise<number> {
        if (this.language.compileCommand) {
            await execAsync(this.language.compileCommand);
        }
        if (this.language.runCommand === undefined) return 0;

        const failExtensions = this.language.features.map(f => `.fail.${f}.json`).concat([".fail.json"]);

        for (const filename of additionalFiles) {
            if (failExtensions.some(ext => filename.endsWith(ext))) {
                callAndExpectFailure(
                    `Expected failure on input ${filename}`,
                    () =>
                        exec(
                            defined(this.language.runCommand)(filename),
                            runEnvForLanguage(additionalRendererOptions),
                            false
                        ).stdout
                );
            } else {
                let expected = filename;
                for (const feature of this.language.features) {
                    const featureFilename = filename.replace(".json", `.out.${feature}.json`);
                    if (fs.existsSync(featureFilename)) {
                        expected = featureFilename;
                        break;
                    }
                }
                compareJsonFileToJson(comparisonArgs(this.language, filename, expected, additionalRendererOptions));
            }
        }
        return additionalFiles.length;
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
        return additionalTestFiles(baseName, "json");
    }

    async test(
        _filename: string,
        additionalRendererOptions: RendererOptions,
        additionalFiles: string[]
    ): Promise<number> {
        if (this.language.compileCommand) {
            await execAsync(this.language.compileCommand);
        }
        if (this.language.runCommand === undefined) return 0;

        for (const fn of additionalFiles) {
            compareJsonFileToJson(comparisonArgs(this.language, fn, fn, additionalRendererOptions));
        }
        return additionalFiles.length;
    }
}

class CommandSuccessfulLanguageFixture extends LanguageFixture {
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
        _additionalRendererOptions: RendererOptions,
        _additionalFiles: string[]
    ): Promise<number> {
        if (this.language.compileCommand) {
            await execAsync(this.language.compileCommand);
        }

        if (this.language.runCommand === undefined) {
            throw new Error("Invalid run command.");
        }

        const command = this.language.runCommand(filename);
        const results = await execAsync(command);

        if (results.stdout.indexOf("Success") === -1) {
            throw new Error(`Test failed:\n${results.stdout}`);
        }

        return 0;
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

        const combinationInputs = _.map([1, 2, 3, 4], n =>
            _.find(prioritySamples, p => p.endsWith(`/priority/combinations${n}.json`))
        );
        if (combinationInputs.some(p => p === undefined)) {
            return failWith("priority/combinations[1234].json samples not found", prioritySamples);
        }
        if (sources.length === 0 && !ONLY_OUTPUT) {
            const quickTestSamples = _.chain(this.language.quickTestRendererOptions)
                .flatMap(qt => {
                    if (Array.isArray(qt)) {
                        const [filename, ro] = qt;
                        const input = _.find(([] as string[]).concat(prioritySamples, miscSamples), p =>
                            p.endsWith(`/${filename}`)
                        );
                        if (input === undefined) {
                            return failWith(`quick-test sample ${filename} not found`, qt);
                        }
                        return [
                            {
                                path: input,
                                additionalRendererOptions: ro,
                                saveOutput: false
                            }
                        ];
                    } else {
                        return _.map(combinationInputs, p => ({
                            path: defined(p),
                            additionalRendererOptions: qt,
                            saveOutput: false
                        }));
                    }
                })
                .value();
            priority = quickTestSamples.concat(priority);
        }

        return { priority, others };
    }
}

export const allFixtures: Fixture[] = [
    // new JSONFixture(languages.CrystalLanguage),
    new JSONFixture(languages.CSharpLanguage),
    new JSONFixture(languages.CSharpLanguageSystemTextJson, "csharp-SystemTextJson"),
    new JSONFixture(languages.JavaLanguage),
    new JSONFixture(languages.JavaLanguageWithLegacyDateTime, "java-datetime-legacy"),
    new JSONFixture(languages.JavaLanguageWithLombok, "java-lombok"),
    new JSONFixture(languages.GoLanguage),
    new JSONFixture(languages.CJSONLanguage),
    new JSONFixture(languages.CPlusPlusLanguage),
    new JSONFixture(languages.PHPLanguage),
    new JSONFixture(languages.RustLanguage),
    new JSONFixture(languages.RubyLanguage),
    new JSONFixture(languages.PythonLanguage),
    new JSONFixture(languages.ElmLanguage),
    new JSONFixture(languages.SwiftLanguage),
    new JSONFixture(languages.ObjectiveCLanguage),
    new JSONFixture(languages.TypeScriptLanguage),
    new JSONFixture(languages.TypeScriptZodLanguage),
    new JSONFixture(languages.TypeScriptEffectSchemaLanguage),
    new JSONFixture(languages.FlowLanguage),
    new JSONFixture(languages.JavaScriptLanguage),
    new JSONFixture(languages.KotlinLanguage),
    new JSONFixture(languages.Scala3Language),
    new JSONFixture(languages.KotlinJacksonLanguage, "kotlin-jackson"),
    new JSONFixture(languages.DartLanguage),
    new JSONFixture(languages.PikeLanguage),
    new JSONFixture(languages.HaskellLanguage),
    new JSONSchemaJSONFixture(languages.CSharpLanguage),
    new JSONTypeScriptFixture(languages.CSharpLanguage),
    // new JSONSchemaFixture(languages.CrystalLanguage),
    new JSONSchemaFixture(languages.CSharpLanguage),
    new JSONSchemaFixture(languages.JavaLanguage),
    new JSONSchemaFixture(languages.JavaLanguageWithLegacyDateTime, "schema-java-datetime-legacy"),
    new JSONSchemaFixture(languages.JavaLanguageWithLombok, "schema-java-lombok"),
    new JSONSchemaFixture(languages.GoLanguage),
    new JSONSchemaFixture(languages.CJSONLanguage),
    new JSONSchemaFixture(languages.CPlusPlusLanguage),
    new JSONSchemaFixture(languages.RustLanguage),
    new JSONSchemaFixture(languages.RubyLanguage),
    new JSONSchemaFixture(languages.PythonLanguage),
    new JSONSchemaFixture(languages.ElmLanguage),
    new JSONSchemaFixture(languages.SwiftLanguage),
    new JSONSchemaFixture(languages.TypeScriptLanguage),
    new JSONSchemaFixture(languages.FlowLanguage),
    new JSONSchemaFixture(languages.JavaScriptLanguage),
    new JSONSchemaFixture(languages.KotlinLanguage),
    new JSONSchemaFixture(languages.KotlinJacksonLanguage, "schema-kotlin-jackson"),
    new JSONSchemaFixture(languages.Scala3Language),
    new JSONSchemaFixture(languages.DartLanguage),
    new JSONSchemaFixture(languages.PikeLanguage),
    new JSONSchemaFixture(languages.HaskellLanguage),
    // FIXME: Why are we missing so many language with GraphQL?
    new GraphQLFixture(languages.CSharpLanguage),
    new GraphQLFixture(languages.JavaLanguage),
    new GraphQLFixture(languages.JavaLanguageWithLegacyDateTime, false, "graphql-java-datetime-legacy"),
    new GraphQLFixture(languages.JavaLanguageWithLombok, false, "graphql-java-lombok"),
    new GraphQLFixture(languages.GoLanguage),
    new GraphQLFixture(languages.CJSONLanguage),
    new GraphQLFixture(languages.CPlusPlusLanguage),
    new GraphQLFixture(languages.PythonLanguage),
    new GraphQLFixture(languages.SwiftLanguage),
    new GraphQLFixture(languages.ObjectiveCLanguage, true),
    new GraphQLFixture(languages.TypeScriptLanguage),
    new GraphQLFixture(languages.FlowLanguage),
    new GraphQLFixture(languages.JavaScriptLanguage),
    new GraphQLFixture(languages.DartLanguage),
    new GraphQLFixture(languages.PikeLanguage),
    new GraphQLFixture(languages.HaskellLanguage),
    new GraphQLFixture(languages.PHPLanguage),
    new CommandSuccessfulLanguageFixture(languages.JavaScriptPropTypesLanguage)
];
