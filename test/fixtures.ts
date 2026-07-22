import * as _ from "lodash";
import * as path from "node:path";
import * as fs from "node:fs";
import { randomBytes } from "node:crypto";
import * as shell from "shelljs";

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const draft06MetaSchema = require("ajv/dist/refs/json-schema-draft-06.json");

import {
    compareJsonFileToJson,
    debug,
    exec,
    execAsync,
    failWith,
    inDir,
    quicktype,
    quicktypeForLanguage,
    type Sample,
    samplesFromSources,
    testsInDir,
    type ComparisonArgs,
    mkdirs,
    callAndExpectFailure,
} from "./utils";
import * as languages from "./languages";
import {
    FetchingJSONSchemaStore,
    InputData,
    JSONSchemaInput,
    type LanguageName,
    type Option,
    type RendererOptions,
    quicktype as quicktypeCore,
    quicktypeMultiFile,
} from "quicktype-core";
import {
    mustNotHappen,
    defined,
} from "../packages/quicktype-core/dist/support/Support";
import { DefaultDateTimeRecognizer } from "../packages/quicktype-core/dist/DateTime";
import { saveOutputSnapshot, snapshotFileState } from "./outputSnapshot";

import chalk from "chalk";
const timeout = require("promise-timeout").timeout;

const OUTPUT_DIR = process.env.OUTPUT_DIR;
const OUTPUT_SNAPSHOT_DIR = process.env.OUTPUT_SNAPSHOT_DIR;
const ONLY_OUTPUT =
    process.env.ONLY_OUTPUT !== undefined || OUTPUT_SNAPSHOT_DIR !== undefined;
const INCLUDE_RENDERER_OPTION_SAMPLES =
    !ONLY_OUTPUT || OUTPUT_SNAPSHOT_DIR !== undefined;

const MAX_TEST_RUNTIME_MS = 30 * 60 * 1000;

/**
 * These are tests where we have stringified integers that might be serialized
 * back as integers, which happens in heterogenous arrays such as ["123", 456].
 */
const testsWithStringifiedIntegers = [
    "nst-test-suite.json",
    "kitchen-sink.json",
];

function allowStringifiedIntegers(
    language: languages.Language,
    test: string,
): boolean {
    if (language.features.indexOf("integer-string") < 0) return false;
    return testsWithStringifiedIntegers.indexOf(path.basename(test)) >= 0;
}

function pathWithoutExtension(fullPath: string, extension: string): string {
    return path.join(
        path.dirname(fullPath),
        path.basename(fullPath, extension),
    );
}

function additionalTestFiles(
    base: string,
    extension: string,
    features: string[] = [],
): string[] {
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
            found =
                tryAdd(
                    `${base}.${i.toString()}.fail.${feature}.${extension}`,
                ) || found;
        }
        found = tryAdd(`${base}.${i.toString()}.fail.${extension}`) || found;

        i++;
    } while (found);
    return additionalFiles;
}

function runEnvForLanguage(
    additionalRendererOptions: RendererOptions,
): NodeJS.ProcessEnv {
    const newEnv = { ...process.env };

    for (const option of Object.keys(additionalRendererOptions)) {
        newEnv[`QUICKTYPE_${option.toUpperCase().replace("-", "_")}`] = (
            additionalRendererOptions[
                option as keyof typeof additionalRendererOptions
            ] as Option<string, unknown>
        ).name;
    }
    return newEnv;
}

function comparisonArgs(
    language: languages.Language,
    inputFilename: string,
    expectedFilename: string,
    additionalRendererOptions: RendererOptions,
): ComparisonArgs {
    return {
        expectedFile: expectedFilename,
        given: {
            command: defined(language.runCommand)(inputFilename),
            env: runEnvForLanguage(additionalRendererOptions),
        },
        strict: false,
        allowMissingNull: language.allowMissingNull,
        allowStringifiedIntegers: allowStringifiedIntegers(
            language,
            expectedFilename,
        ),
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
        console.log(`${fullMessage}: ${chalk.red("UNKNOWN TIMING")}`);
        return;
    }
    const diff = Date.now() - start;
    console.log(`${fullMessage}: ${diff} ms`);
}

export abstract class Fixture {
    abstract name: string;

    constructor(public language: languages.Language) {}

    runForName(name: string): boolean {
        return this.name === name;
    }

    async setup(): Promise<void> {}

    abstract getSamples(sources: string[]): {
        priority: Sample[];
        others: Sample[];
    };

    abstract runWithSample(
        sample: Sample,
        index: number,
        total: number,
    ): Promise<void>;

    getRunDirectory(): string {
        return `test/runs/${this.name}-${randomBytes(3).toString("hex")}`;
    }

    runMessageStart(
        sample: Sample,
        index: number,
        total: number,
        cwd: string,
        shouldSkip: boolean,
    ): string {
        const rendererOptions = _.map(
            sample.additionalRendererOptions,
            (v, k) => `${k}: ${v}`,
        ).join(", ");
        const messageParts = [
            "*",
            chalk.dim(`[${index + 1}/${total}]`),
            chalk.magenta(this.name) + chalk.dim(`(${rendererOptions})`),
            path.join(cwd, chalk.cyan(path.basename(sample.path))),
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
        const suffix =
            numFiles <= 0
                ? chalk.red(numFilesString)
                : numFiles > 1
                  ? chalk.green(numFilesString)
                  : "";
        timeEnd(message, suffix);
    }
}

abstract class LanguageFixture extends Fixture {
    async setup() {
        const setupCommand = this.language.setupCommand;
        if (!setupCommand || ONLY_OUTPUT) {
            return;
        }

        console.error(`* Setting up ${chalk.magenta(this.name)} fixture`);

        await inDir(this.language.base, async () => {
            await execAsync(setupCommand);
        });
    }

    abstract shouldSkipTest(sample: Sample): boolean;
    abstract runQuicktype(
        filename: string,
        additionalRendererOptions: RendererOptions,
    ): Promise<void>;
    abstract test(
        filename: string,
        additionalRendererOptions: RendererOptions,
        additionalFiles: string[],
    ): Promise<number>;

    additionalFiles(_sample: Sample): string[] {
        return [];
    }

    async runWithSample(sample: Sample, index: number, total: number) {
        const cwd = this.getRunDirectory();
        const sampleFile = path.resolve(sample.path);
        const shouldSkip = this.shouldSkipTest(sample);
        const additionalFiles = this.additionalFiles(sample).map((p) =>
            path.resolve(p),
        );

        const message = this.runMessageStart(
            sample,
            index,
            total,
            cwd,
            shouldSkip,
        );

        if (shouldSkip) {
            return;
        }

        shell.cp("-R", this.language.base, cwd);

        if (this.language.copyInput) {
            shell.cp(sampleFile, cwd);
        }

        const beforeGeneration =
            OUTPUT_SNAPSHOT_DIR === undefined
                ? undefined
                : snapshotFileState(cwd);

        let numFiles = -1;
        await inDir(cwd, async () => {
            await this.runQuicktype(
                sampleFile,
                sample.additionalRendererOptions,
            );

            if (ONLY_OUTPUT) {
                return;
            }

            try {
                numFiles = await timeout(
                    this.test(
                        sampleFile,
                        sample.additionalRendererOptions,
                        additionalFiles,
                    ),
                    MAX_TEST_RUNTIME_MS,
                );
            } catch (e) {
                failWith("Fixture threw an exception", { error: e, sample });
            }
        });

        if (OUTPUT_SNAPSHOT_DIR !== undefined) {
            saveOutputSnapshot({
                before: defined(beforeGeneration),
                fixtureName: this.name,
                primaryOutput: this.language.output,
                rendererOptions: sample.additionalRendererOptions,
                runDirectory: cwd,
                samplePath: sample.path,
                snapshotRoot: OUTPUT_SNAPSHOT_DIR,
            });
        } else if (
            sample.saveOutput &&
            OUTPUT_DIR !== undefined &&
            this.language.output.indexOf("/") < 0
        ) {
            // Keep the legacy single-file output path for callers of
            // OUTPUT_DIR.  Snapshot mode above also handles nested and
            // multi-file renderer output.
            const outputDir = path.join(
                OUTPUT_DIR,
                this.language.name,
                path.dirname(sample.path),
                path.basename(sample.path, path.extname(sample.path)),
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
    constructor(
        language: languages.Language,
        public name: string = language.name,
    ) {
        super(language);
    }

    runForName(name: string): boolean {
        return this.name === name || name === "json";
    }

    async runQuicktype(
        sample: string,
        additionalRendererOptions: RendererOptions,
    ): Promise<void> {
        // FIXME: add options
        await quicktypeForLanguage(
            this.language,
            sample,
            "json",
            true,
            additionalRendererOptions,
        );
    }

    async test(
        filename: string,
        additionalRendererOptions: RendererOptions,
        _additionalFiles: string[],
    ): Promise<number> {
        if (this.language.compileCommand) {
            await execAsync(this.language.compileCommand);
        }
        if (this.language.runCommand === undefined) {
            return 0;
        }

        // The analog of the JSON Schema fixture's `.out.<feature>.json`
        // convention: a JSON input `foo.json` can come with an expected-output
        // file `foo.out.<key>.json`, which applies when `<key>` is one of the
        // language's `features`, or the name of a renderer option this
        // particular run sets (via `quickTestRendererOptions`).  When it
        // applies, the output must match it exactly, without the usual
        // round-trip leniency for null properties.  This is how output that
        // legitimately differs from the input — e.g. Go's `omitempty`
        // dropping null fields — gets asserted.
        let expectedFilename = filename;
        let strict = false;
        const expectedOutputKeys = [
            ...this.language.features,
            ...Object.keys(additionalRendererOptions),
        ];
        for (const key of expectedOutputKeys) {
            const outFilename = filename.replace(/\.json$/, `.out.${key}.json`);
            if (fs.existsSync(outFilename)) {
                expectedFilename = outFilename;
                strict = true;
                break;
            }
        }

        compareJsonFileToJson({
            ...comparisonArgs(
                this.language,
                filename,
                expectedFilename,
                additionalRendererOptions,
            ),
            strict,
        });

        if (
            this.language.diffViaSchema &&
            !_.includes(
                this.language.skipDiffViaSchema,
                path.basename(filename),
            )
        ) {
            debug("* Diffing with code generated via JSON Schema");
            // Make a schema
            await quicktype({
                src: [filename],
                lang: "schema",
                out: "schema.json",
                topLevel: this.language.topLevel,
                rendererOptions: {},
            });
            // Quicktype from the schema and compare to expected code
            shell.mv(this.language.output, `${this.language.output}.expected`);
            await quicktypeForLanguage(
                this.language,
                "schema.json",
                "schema",
                true,
                additionalRendererOptions,
            );

            // Compare fixture.output to fixture.output.expected
            exec(
                `diff -Naur ${this.language.output}.expected ${this.language.output} > /dev/null 2>&1`,
                undefined,
            );
        }

        return 1;
    }

    shouldSkipTest(sample: Sample): boolean {
        if (fs.statSync(sample.path).size > 32 * 1024 * 1024) {
            return true;
        }
        if (this.language.includeJSON !== undefined) {
            return !_.includes(
                this.language.includeJSON,
                path.basename(sample.path),
            );
        }
        if (this.language.skipJSON !== undefined) {
            return _.includes(
                this.language.skipJSON,
                path.basename(sample.path),
            );
        }
        return false;
    }

    getSamples(sources: string[]): { priority: Sample[]; others: Sample[] } {
        // FIXME: this should only run once
        const prioritySamples = _.concat(
            testsInDir("test/inputs/json/priority", "json"),
            testsInDir("test/inputs/json/samples", "json"),
        );

        const skipMiscJSON =
            process.env.QUICKTEST !== undefined || this.language.skipMiscJSON;
        const miscSamples = skipMiscJSON
            ? []
            : testsInDir("test/inputs/json/misc", "json");

        let { priority, others } = samplesFromSources(
            sources,
            prioritySamples,
            miscSamples,
            "json",
        );

        const combinationInputs = _.map([1, 2, 3, 4], (n) =>
            _.find(prioritySamples, (p) =>
                p.endsWith(`/priority/combinations${n}.json`),
            ),
        );
        if (combinationInputs.some((p) => p === undefined)) {
            return failWith(
                "priority/combinations[1234].json samples not found",
                { prioritySamples },
            );
        }
        if (sources.length === 0 && INCLUDE_RENDERER_OPTION_SAMPLES) {
            const quickTestSamples = _.chain(
                this.language.quickTestRendererOptions,
            )
                .flatMap((qt) => {
                    if (Array.isArray(qt)) {
                        const [filename, ro] = qt;
                        if (filename.endsWith(".schema")) {
                            // Runs in the JSON Schema fixture instead.
                            return [];
                        }

                        const input = _.find(
                            ([] as string[]).concat(
                                prioritySamples,
                                miscSamples,
                            ),
                            (p) => p.endsWith(`/${filename}`),
                        );

                        if (input === undefined) {
                            return failWith(
                                `quick-test sample ${filename} not found`,
                                { qt },
                            );
                        }
                        return [
                            {
                                path: input,
                                additionalRendererOptions: ro,
                                saveOutput: false,
                            },
                        ];
                    }

                    return _.map(combinationInputs, (p) => ({
                        path: defined(p),
                        additionalRendererOptions: qt,
                        saveOutput: false,
                    }));
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
        languageXName: LanguageName,
        languageXOutputFilename: string,
        rendererOptions: RendererOptions,
        skipJSON: string[],
        language: languages.Language,
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
            sourceFiles: language.sourceFiles,
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
        _additionalFiles: string[],
    ): Promise<number> {
        // Generate code for Y from X
        await quicktypeForLanguage(
            this.runLanguage,
            this.language.output,
            this.language.name,
            false,
            additionalRendererOptions,
        );

        // Parse the sample with the code generated from its schema, and compare to the sample
        compareJsonFileToJson(
            comparisonArgs(
                this.runLanguage,
                filename,
                filename,
                additionalRendererOptions,
            ),
        );

        return 1;
    }

    shouldSkipTest(sample: Sample): boolean {
        if (super.shouldSkipTest(sample)) return true;
        return _.includes(
            this.runLanguage.skipJSON,
            path.basename(sample.path),
        );
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
            "ed095.json", // same here on Travis
        ];
        super("schema-json", "schema", "schema.json", {}, skipJSON, language);
    }

    async test(
        filename: string,
        additionalRendererOptions: RendererOptions,
        additionalFiles: string[],
    ): Promise<number> {
        const input = JSON.parse(fs.readFileSync(filename, "utf8"));
        const schema = JSON.parse(
            fs.readFileSync(this.language.output, "utf8"),
        );

        const ajv = new Ajv();
        // We generate draft-06 schemas, which Ajv 8 doesn't support out of
        // the box anymore.
        ajv.addMetaSchema(draft06MetaSchema);
        // Ajv 8 moved the format validators into the ajv-formats package;
        // its default mode is "full", like the old `format: "full"` option.
        addFormats(ajv);
        // Our custom schema keywords, which strict mode would reject.
        ajv.addVocabulary(["qt-uri-protocols", "qt-uri-extensions"]);
        // Make Ajv's date-time compatible with what we recognize.  All non-standard
        // JSON formats that we use for transformed type kinds must be registered here
        // with a validation function.  Formats registered with `true` are
        // accepted without validating the string.  This replaces the old
        // `unknownFormats: ["integer", "boolean"]` option.
        // FIXME: Unify this with what's in StringTypes.ts.
        ajv.addFormat("date-time", (s: string) =>
            dateTimeRecognizer.isDateTime(s),
        );
        ajv.addFormat("integer", true);
        ajv.addFormat("boolean", true);
        const valid = ajv.validate(schema, input);
        if (!valid) {
            failWith("Generated schema does not validate input JSON.", {
                filename,
            });
        }

        await super.test(filename, additionalRendererOptions, additionalFiles);

        // Generate a schema from the schema, making sure the schemas are the same
        // FIXME: We could move this to the superclass and test it for all JSON->X->Y
        const schemaSchema = "schema-from-schema.json";
        await quicktype({
            src: [this.language.output],
            srcLang: this.language.name,
            lang: this.language.name,
            topLevel: this.language.topLevel,
            out: schemaSchema,
            rendererOptions: {},
        });
        compareJsonFileToJson({
            expectedFile: this.language.output,
            given: { file: schemaSchema },
            strict: true,
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
    "kotlin-enum-class-case-collision.json",
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
    "f466a.json",
];

class JSONTypeScriptFixture extends JSONToXToYFixture {
    constructor(language: languages.Language) {
        super(
            "json-ts",
            "ts",
            "typescript.ts",
            { "just-types": "true" },
            [],
            language,
        );
    }

    shouldSkipTest(sample: Sample): boolean {
        if (super.shouldSkipTest(sample)) return true;
        return skipTypeScriptTests.indexOf(path.basename(sample.path)) >= 0;
    }
}

// This fixture tests generating code from JSON Schema.
class JSONSchemaFixture extends LanguageFixture {
    constructor(
        language: languages.Language,
        readonly name: string = `schema-${language.name}`,
    ) {
        super(language);
    }

    runForName(name: string): boolean {
        return this.name === name || name === "schema";
    }

    getSamples(sources: string[]): { priority: Sample[]; others: Sample[] } {
        const prioritySamples = testsInDir("test/inputs/schema/", "schema");
        const samples = samplesFromSources(
            sources,
            prioritySamples,
            [],
            "schema",
        );

        if (sources.length === 0 && INCLUDE_RENDERER_OPTION_SAMPLES) {
            // Pinned-input quick-test entries that name a `.schema` file
            // run in this fixture with their renderer options.  Plain
            // renderer-option combinations and `.json` entries run in
            // the JSON fixture.
            const quickTestSamples = _.chain(
                this.language.quickTestRendererOptions,
            )
                .flatMap((qt) => {
                    if (!Array.isArray(qt)) return [];

                    const [filename, ro] = qt;
                    if (!filename.endsWith(".schema")) return [];

                    const input = _.find(prioritySamples, (p) =>
                        p.endsWith(`/${filename}`),
                    );
                    if (input === undefined) {
                        return failWith(
                            `quick-test schema ${filename} not found`,
                            { qt },
                        );
                    }

                    return [
                        {
                            path: input,
                            additionalRendererOptions: ro,
                            saveOutput: false,
                        },
                    ];
                })
                .value();
            samples.priority = quickTestSamples.concat(samples.priority);
        }

        return samples;
    }

    shouldSkipTest(sample: Sample): boolean {
        return _.includes(this.language.skipSchema, path.basename(sample.path));
    }

    async runQuicktype(
        filename: string,
        additionalRendererOptions: RendererOptions,
    ): Promise<void> {
        await quicktypeForLanguage(
            this.language,
            filename,
            "schema",
            false,
            additionalRendererOptions,
        );
    }

    additionalFiles(sample: Sample): string[] {
        const baseName = pathWithoutExtension(sample.path, ".schema");
        return additionalTestFiles(baseName, "json", this.language.features);
    }

    async test(
        _sample: string,
        additionalRendererOptions: RendererOptions,
        additionalFiles: string[],
    ): Promise<number> {
        if (this.language.compileCommand) {
            await execAsync(this.language.compileCommand);
        }
        if (this.language.runCommand === undefined) return 0;

        const failExtensions = this.language.features
            .map((f) => `.fail.${f}.json`)
            .concat([".fail.json"]);

        for (const filename of additionalFiles) {
            if (failExtensions.some((ext) => filename.endsWith(ext))) {
                callAndExpectFailure(
                    `Expected failure on input ${filename}`,
                    () =>
                        exec(
                            defined(this.language.runCommand)(filename),
                            runEnvForLanguage(additionalRendererOptions),
                            false,
                        ).stdout,
                );
            } else {
                let expected = filename;
                for (const feature of this.language.features) {
                    const featureFilename = filename.replace(
                        ".json",
                        `.out.${feature}.json`,
                    );
                    if (fs.existsSync(featureFilename)) {
                        expected = featureFilename;
                        break;
                    }
                }
                compareJsonFileToJson(
                    comparisonArgs(
                        this.language,
                        filename,
                        expected,
                        additionalRendererOptions,
                    ),
                );
            }
        }
        return additionalFiles.length;
    }
}

// `leadingComments` is a quicktype-core API option, so the CLI fixture path
// cannot exercise it.
class LeadingCommentsGoFixture extends JSONSchemaFixture {
    constructor() {
        super(languages.GoLanguage, "schema-golang-leading-comments");
    }

    getSamples(sources: string[]): { priority: Sample[]; others: Sample[] } {
        return samplesFromSources(
            sources,
            ["test/inputs/schema/date-time.schema"],
            [],
            "schema",
        );
    }

    private async inputData(filename: string): Promise<InputData> {
        const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());
        await schemaInput.addSource({
            name: this.language.topLevel,
            schema: fs.readFileSync(filename, "utf8"),
        });
        const inputData = new InputData();
        inputData.addInput(schemaInput);
        return inputData;
    }

    async runQuicktype(
        filename: string,
        additionalRendererOptions: RendererOptions,
    ): Promise<void> {
        const rendererOptions = _.merge(
            {},
            this.language.rendererOptions,
            additionalRendererOptions,
        );
        const result = await quicktypeCore({
            inputData: await this.inputData(filename),
            lang: this.language.name,
            leadingComments: [],
            rendererOptions,
        });
        fs.writeFileSync(this.language.output, result.lines.join("\n"));

        const multiFileResult = await quicktypeMultiFile({
            inputData: await this.inputData(filename),
            lang: this.language.name,
            leadingComments: [],
            rendererOptions: {
                ...rendererOptions,
                "multi-file-output": true,
            },
        });
        mkdirs("multi");
        for (const [outputFilename, output] of multiFileResult) {
            fs.writeFileSync(
                path.join("multi", outputFilename),
                output.lines.join("\n"),
            );
        }
    }

    async test(
        filename: string,
        additionalRendererOptions: RendererOptions,
        additionalFiles: string[],
    ): Promise<number> {
        const numFiles = await super.test(
            filename,
            additionalRendererOptions,
            additionalFiles,
        );
        await execAsync("go test multi/*.go");
        return numFiles + testsInDir("multi", "go").length;
    }
}

type TreeSitterTarget = {
    displayName: string;
    language: languages.Language;
    output: string;
    wasmModule: string;
    extensions: string[];
    schema: string;
    allowMissingNodes?: boolean;
    // Rewrite the generated source before parsing, to work around
    // false positives in a buggy tree-sitter grammar.
    preprocessSource?: (source: string) => string;
    // Raw substrings that must not survive into the generated output.
    // Used for injection classes the tree-sitter grammars can't catch,
    // because their lexers are more lenient than the real compiler
    // (e.g. XML metacharacters in C# doc comments, which parse fine as
    // comment text but break the XML doc tooling).
    forbiddenSubstrings?: string[];
};

// Line terminators that a language's real lexer honors but which are
// not `\n`, so they must never survive into a generated single-line
// comment.  The tree-sitter grammars treat them as ordinary
// characters, so this is checked by content scan rather than parsing.
const unicodeLineTerminators: ReadonlyArray<readonly [string, number]> = [
    ["U+0085 NEL", 0x0085],
    ["U+2028 LINE SEPARATOR", 0x2028],
    ["U+2029 PARAGRAPH SEPARATOR", 0x2029],
];

type TreeSitterContentFailure = {
    language: string;
    filename: string;
    forbidden: string;
};

type TreeSitterParseProblem = {
    type: string;
    startPosition: unknown;
    endPosition: unknown;
};

type TreeSitterParseFailure = {
    language: string;
    filename: string;
    problems: TreeSitterParseProblem[];
};

const commentInjectionSchema = "test/inputs/schema/comment-injection.schema";
const commentInjectionEnumSchema =
    "test/inputs/schema/comment-injection-enum.schema";
const commentInjectionNestedCommentSchema =
    "test/inputs/schema/comment-injection-nested-comment.schema";
const commentInjectionEnumNestedCommentSchema =
    "test/inputs/schema/comment-injection-enum-nested-comment.schema";
const treeSitterWasm = (filename: string): string =>
    // biome-ignore lint/correctness/noGlobalDirnameFilename: the test harness runs as CommonJS
    path.join(__dirname, "tree-sitter-wasms", filename);

const commentInjectionTreeSitterTargets: TreeSitterTarget[] = [
    {
        displayName: "typescript",
        language: languages.TypeScriptLanguage,
        output: "TopLevel.ts",
        wasmModule: "tree-sitter-typescript/tree-sitter-typescript.wasm",
        extensions: [".ts"],
        schema: commentInjectionSchema,
    },
    {
        displayName: "typescript-zod",
        language: languages.TypeScriptZodLanguage,
        output: "TopLevel.ts",
        wasmModule: "tree-sitter-typescript/tree-sitter-typescript.wasm",
        extensions: [".ts"],
        schema: commentInjectionEnumSchema,
    },
    {
        displayName: "typescript-effect-schema",
        language: languages.TypeScriptEffectSchemaLanguage,
        output: "TopLevel.ts",
        wasmModule: "tree-sitter-typescript/tree-sitter-typescript.wasm",
        extensions: [".ts"],
        schema: commentInjectionEnumSchema,
    },
    {
        displayName: "swift",
        language: languages.SwiftLanguage,
        output: "quicktype.swift",
        wasmModule: treeSitterWasm("tree-sitter-swift.wasm"),
        extensions: [".swift"],
        schema: commentInjectionSchema,
    },
    {
        displayName: "csharp",
        language: languages.CSharpLanguage,
        output: "QuickType.cs",
        wasmModule: "tree-sitter-c-sharp/tree-sitter-c_sharp.wasm",
        extensions: [".cs"],
        schema: commentInjectionSchema,
        // C# doc comments are XML; the payload's markup must be entity
        // escaped.  tree-sitter parses it as comment text either way,
        // so the escaping is verified by content scan.
        forbiddenSubstrings: ["</summary> & <br>", "<summary> & <br>"],
    },
    {
        displayName: "java",
        language: languages.JavaLanguage,
        output: "TopLevel.java",
        wasmModule: "tree-sitter-java/tree-sitter-java.wasm",
        extensions: [".java"],
        schema: commentInjectionSchema,
    },
    {
        displayName: "dart",
        language: languages.DartLanguage,
        output: "TopLevel.dart",
        wasmModule: treeSitterWasm("tree-sitter-dart.wasm"),
        extensions: [".dart"],
        schema: commentInjectionSchema,
        // tree-sitter-dart wrongly treats a block-comment opener inside
        // a line comment as opening a block comment (`// /*` parses as
        // an ERROR), whereas real Dart runs line comments to the end of
        // the line.  Neutralize openers in comment text before parsing.
        preprocessSource: (source) =>
            source.replace(/\/\/[^\n]*/g, (comment) =>
                comment.replace(/\/\*/g, "/ *"),
            ),
    },
    {
        displayName: "cjson",
        language: languages.CJSONLanguage,
        // CJSONLanguage renders with header-only=false, so this produces
        // both TopLevel.h and TopLevel.c; both are collected and parsed.
        output: "TopLevel.h",
        wasmModule: "tree-sitter-c/tree-sitter-c.wasm",
        extensions: [".c", ".h"],
        schema: commentInjectionSchema,
        // tree-sitter-c parses `#ifdef`/`#endif` as real structure and
        // can't match the `extern "C" {` brace across the two separate
        // `#ifdef __cplusplus` guard blocks, so it reports a spurious
        // MISSING `#endif` even for benign output.  Strip the guard
        // blocks (they only wrap the file) so a real injection that
        // leaves a MISSING node is still caught.
        preprocessSource: (source) =>
            source.replace(
                /#ifdef __cplusplus\n(?:extern "C" \{|\})\n#endif\n/g,
                "",
            ),
    },
    {
        displayName: "cplusplus",
        language: languages.CPlusPlusLanguage,
        output: "TopLevel.cpp",
        wasmModule: "tree-sitter-cpp/tree-sitter-cpp.wasm",
        extensions: [".cpp", ".hpp", ".h"],
        schema: commentInjectionSchema,
    },
    {
        displayName: "php",
        language: languages.PHPLanguage,
        output: "TopLevel.php",
        wasmModule: "tree-sitter-php/tree-sitter-php.wasm",
        extensions: [".php"],
        schema: commentInjectionSchema,
    },
    {
        displayName: "kotlin",
        language: languages.KotlinLanguage,
        output: "TopLevel.kt",
        wasmModule: treeSitterWasm("tree-sitter-kotlin.wasm"),
        extensions: [".kt"],
        schema: commentInjectionSchema,
    },
    {
        displayName: "go",
        language: languages.GoLanguage,
        output: "quicktype.go",
        wasmModule: "tree-sitter-go/tree-sitter-go.wasm",
        extensions: [".go"],
        schema: commentInjectionSchema,
    },
    {
        displayName: "pike",
        language: languages.PikeLanguage,
        output: "TopLevel.pmod",
        wasmModule: treeSitterWasm("tree-sitter-pike.wasm"),
        extensions: [".pmod"],
        schema: commentInjectionSchema,
    },
    {
        displayName: "rust",
        language: languages.RustLanguage,
        output: "module_under_test.rs",
        wasmModule: "tree-sitter-rust/tree-sitter-rust.wasm",
        extensions: [".rs"],
        schema: commentInjectionSchema,
    },
    {
        displayName: "ruby",
        language: languages.RubyLanguage,
        output: "TopLevel.rb",
        wasmModule: "tree-sitter-ruby/tree-sitter-ruby.wasm",
        extensions: [".rb"],
        schema: commentInjectionSchema,
    },
    {
        displayName: "python",
        language: languages.PythonLanguage,
        output: "quicktype.py",
        wasmModule: "tree-sitter-python/tree-sitter-python.wasm",
        extensions: [".py"],
        schema: commentInjectionSchema,
    },
    {
        displayName: "elixir",
        language: languages.ElixirLanguage,
        output: "QuickType.ex",
        wasmModule: treeSitterWasm("tree-sitter-elixir.wasm"),
        extensions: [".ex"],
        schema: commentInjectionSchema,
    },
    {
        displayName: "scala3",
        language: languages.Scala3Language,
        output: "TopLevel.scala",
        wasmModule: "tree-sitter-scala/tree-sitter-scala.wasm",
        extensions: [".scala"],
        schema: commentInjectionSchema,
    },
    {
        displayName: "haskell",
        language: languages.HaskellLanguage,
        output: "QuickType.hs",
        wasmModule: "tree-sitter-haskell/tree-sitter-haskell.wasm",
        extensions: [".hs"],
        schema: commentInjectionSchema,
    },
];

function graphQLSchemaFilename(baseName: string): string {
    const baseMatch = baseName.match(/(.*\D)\d+$/);
    if (baseMatch === null) {
        return failWith(
            "GraphQL test filename does not correspond to naming schema",
            { baseName },
        );
    }
    return `${baseMatch[1]}.gqlschema`;
}

class CommentInjectionSchemaFixture extends JSONSchemaFixture {
    constructor(
        language: languages.Language,
        private readonly _samples: string[] = [
            "test/inputs/schema/comment-injection.schema",
            "test/inputs/schema/comment-injection-enum.schema",
            "test/inputs/schema/comment-injection-nested-comment.schema",
            "test/inputs/schema/comment-injection-enum-nested-comment.schema",
        ],
    ) {
        super(language, `comment-injection-${language.name}`);
    }

    runForName(name: string): boolean {
        return this.name === name || name === "comment-injection";
    }

    getSamples(sources: string[]): { priority: Sample[]; others: Sample[] } {
        return samplesFromSources(sources, this._samples, [], "schema");
    }
}

function collectFilesWithExtensions(
    directory: string,
    extensions: string[],
): string[] {
    const result: string[] = [];
    for (const entry of fs.readdirSync(directory)) {
        const fullPath = path.join(directory, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            result.push(...collectFilesWithExtensions(fullPath, extensions));
        } else if (extensions.includes(path.extname(entry))) {
            result.push(fullPath);
        }
    }
    return result;
}

class CommentInjectionTreeSitterFixture extends Fixture {
    name = "comment-injection-treesitter";

    constructor() {
        super(languages.TypeScriptLanguage);
    }

    runForName(name: string): boolean {
        return this.name === name;
    }

    async setup(): Promise<void> {}

    getSamples(sources: string[]): { priority: Sample[]; others: Sample[] } {
        const commentInjectionSamples = [
            commentInjectionSchema,
            commentInjectionNestedCommentSchema,
        ];
        const makeSample = (schema: string): Sample => ({
            path: schema,
            additionalRendererOptions: {},
            saveOutput: false,
        });
        if (sources.length === 0) {
            return {
                priority: commentInjectionSamples.map(makeSample),
                others: [],
            };
        }

        const sourcePaths = _.flatMap(sources, (source) =>
            fs.existsSync(source) && fs.lstatSync(source).isDirectory()
                ? testsInDir(source, "schema")
                : [source],
        );
        const selected = commentInjectionSamples.filter((schema) =>
            sourcePaths.some(
                (source) => path.basename(source) === path.basename(schema),
            ),
        );
        return { priority: selected.map(makeSample), others: [] };
    }

    private readonly _treeSitterLanguages = new Map<string, unknown>();

    private async loadTreeSitterLanguage(
        // biome-ignore lint/suspicious/noExplicitAny: web-tree-sitter is loaded dynamically without types
        TreeSitter: any,
        wasmModule: string,
    ): Promise<unknown> {
        const wasmPath = require.resolve(wasmModule);
        let language = this._treeSitterLanguages.get(wasmPath);
        if (language === undefined) {
            language = await TreeSitter.Language.load(wasmPath);
            this._treeSitterLanguages.set(wasmPath, language);
        }

        return language;
    }

    private async parseGeneratedFiles(
        // biome-ignore lint/suspicious/noExplicitAny: web-tree-sitter is loaded dynamically without types
        TreeSitter: any,
        target: TreeSitterTarget,
        generatedFiles: string[],
    ): Promise<TreeSitterParseFailure[]> {
        const parser = new TreeSitter.Parser();
        const language = await this.loadTreeSitterLanguage(
            TreeSitter,
            target.wasmModule,
        );
        parser.setLanguage(language);

        const failures: TreeSitterParseFailure[] = [];

        for (const filename of generatedFiles) {
            let source = fs.readFileSync(filename, "utf8");
            if (target.preprocessSource !== undefined) {
                source = target.preprocessSource(source);
            }

            const tree = parser.parse(source);
            const problems: TreeSitterParseProblem[] = [];

            // biome-ignore lint/suspicious/noExplicitAny: web-tree-sitter is loaded dynamically without types
            function visit(node: any): void {
                if (
                    node.type === "ERROR" ||
                    (node.isMissing && !target.allowMissingNodes)
                ) {
                    problems.push({
                        type: node.isMissing
                            ? `MISSING ${node.type}`
                            : node.type,
                        startPosition: node.startPosition,
                        endPosition: node.endPosition,
                    });
                }

                for (let i = 0; i < node.childCount; i++) {
                    visit(node.child(i));
                }
            }

            visit(tree.rootNode);

            if (problems.length > 0) {
                failures.push({
                    language: target.displayName,
                    filename,
                    problems: problems.slice(0, 10),
                });
            }
        }

        return failures;
    }

    // Injection classes the tree-sitter grammars can't detect, because
    // their lexers are more lenient than the real compiler: Unicode
    // line terminators surviving into a comment, and per-target markup
    // that parses as comment text but is dangerous downstream.  These
    // are verified by scanning the generated bytes directly.
    private scanGeneratedFiles(
        target: TreeSitterTarget,
        generatedFiles: string[],
    ): TreeSitterContentFailure[] {
        const failures: TreeSitterContentFailure[] = [];
        for (const filename of generatedFiles) {
            const source = fs.readFileSync(filename, "utf8");
            for (const [name, codePoint] of unicodeLineTerminators) {
                if (source.includes(String.fromCodePoint(codePoint))) {
                    failures.push({
                        language: target.displayName,
                        filename,
                        forbidden: name,
                    });
                }
            }

            for (const forbidden of target.forbiddenSubstrings ?? []) {
                if (source.includes(forbidden)) {
                    failures.push({
                        language: target.displayName,
                        filename,
                        forbidden: JSON.stringify(forbidden),
                    });
                }
            }
        }

        return failures;
    }

    async runWithSample(
        sample: Sample,
        index: number,
        total: number,
    ): Promise<void> {
        const cwd = this.getRunDirectory();
        const message = this.runMessageStart(sample, index, total, cwd, false);
        mkdirs(cwd);

        const TreeSitter = require("web-tree-sitter");
        await TreeSitter.Parser.init();

        const repoRoot = process.cwd();
        let parsedFileCount = 0;
        const failures: TreeSitterParseFailure[] = [];
        const contentFailures: TreeSitterContentFailure[] = [];
        await inDir(cwd, async () => {
            for (const target of commentInjectionTreeSitterTargets) {
                const outputDir = path.join(target.displayName);
                mkdirs(outputDir);
                const targetLanguage = {
                    ...target.language,
                    output: path.join(outputDir, target.output),
                };
                // Enum targets can't render the regular schemas, so they
                // get the enum variant of whichever sample is running.
                const schema =
                    target.schema === commentInjectionEnumSchema
                        ? sample.path === commentInjectionNestedCommentSchema
                            ? commentInjectionEnumNestedCommentSchema
                            : commentInjectionEnumSchema
                        : sample.path;
                await quicktypeForLanguage(
                    targetLanguage,
                    path.join(repoRoot, schema),
                    "schema",
                    false,
                    {},
                );

                const generatedFiles = collectFilesWithExtensions(
                    outputDir,
                    target.extensions,
                );
                if (generatedFiles.length === 0) {
                    failWith("No generated files to parse", {
                        language: target.displayName,
                        outputDir,
                        extensions: target.extensions,
                    });
                }

                failures.push(
                    ...(await this.parseGeneratedFiles(
                        TreeSitter,
                        target,
                        generatedFiles,
                    )),
                );
                contentFailures.push(
                    ...this.scanGeneratedFiles(target, generatedFiles),
                );
                parsedFileCount += generatedFiles.length;
            }
        });

        if (failures.length > 0) {
            failWith("tree-sitter parse found syntax errors", {
                failures,
            });
        }

        if (contentFailures.length > 0) {
            failWith("generated output contains forbidden comment content", {
                contentFailures,
            });
        }

        this.runMessageEnd(message, parsedFileCount);
    }
}

class GraphQLFixture extends LanguageFixture {
    constructor(
        language: languages.Language,
        private readonly _onlyExactName: boolean = false,
        readonly name: string = `graphql-${language.name}`,
    ) {
        super(language);
    }

    runForName(name: string): boolean {
        return (
            this.name === name ||
            ((!this._onlyExactName || OUTPUT_SNAPSHOT_DIR !== undefined) &&
                name === "graphql")
        );
    }

    getSamples(sources: string[]): { priority: Sample[]; others: Sample[] } {
        const prioritySamples = testsInDir("test/inputs/graphql/", "graphql");
        return samplesFromSources(sources, prioritySamples, [], "graphql");
    }

    shouldSkipTest(_sample: Sample): boolean {
        return false;
    }

    async runQuicktype(
        filename: string,
        additionalRendererOptions: RendererOptions,
    ): Promise<void> {
        const baseName = pathWithoutExtension(filename, ".graphql");
        const schemaFilename = graphQLSchemaFilename(baseName);
        await quicktypeForLanguage(
            this.language,
            filename,
            "graphql",
            false,
            additionalRendererOptions,
            schemaFilename,
        );
    }

    additionalFiles(sample: Sample): string[] {
        const baseName = pathWithoutExtension(sample.path, ".graphql");
        return additionalTestFiles(baseName, "json");
    }

    async test(
        _filename: string,
        additionalRendererOptions: RendererOptions,
        additionalFiles: string[],
    ): Promise<number> {
        if (this.language.compileCommand) {
            await execAsync(this.language.compileCommand);
        }
        if (this.language.runCommand === undefined) return 0;

        for (const fn of additionalFiles) {
            compareJsonFileToJson(
                comparisonArgs(
                    this.language,
                    fn,
                    fn,
                    additionalRendererOptions,
                ),
            );
        }
        return additionalFiles.length;
    }
}

class CommandSuccessfulLanguageFixture extends LanguageFixture {
    constructor(
        language: languages.Language,
        public name: string = language.name,
    ) {
        super(language);
    }

    runForName(name: string): boolean {
        return this.name === name || name === "json";
    }

    async runQuicktype(
        sample: string,
        additionalRendererOptions: RendererOptions,
    ): Promise<void> {
        // FIXME: add options
        await quicktypeForLanguage(
            this.language,
            sample,
            "json",
            true,
            additionalRendererOptions,
        );
    }

    async test(
        filename: string,
        _additionalRendererOptions: RendererOptions,
        _additionalFiles: string[],
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
            testsInDir("test/inputs/json/samples", "json"),
        );

        const miscSamples = this.language.skipMiscJSON
            ? []
            : testsInDir("test/inputs/json/misc", "json");

        let { priority, others } = samplesFromSources(
            sources,
            prioritySamples,
            miscSamples,
            "json",
        );

        const combinationInputs = _.map([1, 2, 3, 4], (n) =>
            _.find(prioritySamples, (p) =>
                p.endsWith(`/priority/combinations${n}.json`),
            ),
        );
        if (combinationInputs.some((p) => p === undefined)) {
            return failWith(
                "priority/combinations[1234].json samples not found",
                { prioritySamples },
            );
        }
        if (sources.length === 0 && INCLUDE_RENDERER_OPTION_SAMPLES) {
            const quickTestSamples = _.chain(
                this.language.quickTestRendererOptions,
            )
                .flatMap((qt) => {
                    if (Array.isArray(qt)) {
                        const [filename, ro] = qt;
                        if (filename.endsWith(".schema")) {
                            // Runs in the JSON Schema fixture instead.
                            return [];
                        }

                        const input = _.find(
                            ([] as string[]).concat(
                                prioritySamples,
                                miscSamples,
                            ),
                            (p) => p.endsWith(`/${filename}`),
                        );
                        if (input === undefined) {
                            return failWith(
                                `quick-test sample ${filename} not found`,
                                { qt },
                            );
                        }
                        return [
                            {
                                path: input,
                                additionalRendererOptions: ro,
                                saveOutput: false,
                            },
                        ];
                    }

                    return _.map(combinationInputs, (p) => ({
                        path: defined(p),
                        additionalRendererOptions: qt,
                        saveOutput: false,
                    }));
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
    new JSONFixture(
        languages.CSharpLanguageSystemTextJson,
        "csharp-SystemTextJson",
    ),
    new JSONFixture(languages.JavaLanguage),
    new JSONFixture(
        languages.JavaLanguageWithLegacyDateTime,
        "java-datetime-legacy",
    ),
    new JSONFixture(languages.JavaLanguageWithLombok, "java-lombok"),
    new JSONFixture(languages.GoLanguage),
    new JSONFixture(languages.CJSONLanguage),
    new JSONFixture(languages.CJSONDefaultLanguage, "cjson-default"),
    new JSONFixture(languages.CJSONMultiHeaderLanguage, "cjson-multi-header"),
    new JSONFixture(languages.CJSONMultiSplitLanguage, "cjson-multi-split"),
    new JSONFixture(languages.CPlusPlusLanguage),
    new JSONFixture(
        languages.CPlusPlusMultiSourceLanguage,
        "cplusplus-multi-source",
    ),
    new JSONFixture(languages.PHPLanguage),
    new JSONFixture(languages.RustLanguage),
    new JSONFixture(languages.RubyLanguage),
    new JSONFixture(languages.PythonLanguage),
    new JSONFixture(languages.ElmLanguage),
    new JSONFixture(languages.SwiftLanguage),
    new JSONFixture(
        languages.SwiftSendableObjectiveCSupportLanguage,
        "swift-sendable-objective-c",
    ),
    new JSONFixture(languages.ObjectiveCLanguage),
    new JSONFixture(languages.TypeScriptLanguage),
    new JSONFixture(languages.TypeScriptZodLanguage),
    new JSONFixture(languages.TypeScriptEffectSchemaLanguage),
    new JSONFixture(languages.FlowLanguage),
    new JSONFixture(languages.JavaScriptLanguage),
    new JSONFixture(languages.KotlinLanguage),
    new JSONFixture(languages.Scala3Language),
    new JSONFixture(languages.Scala3UpickleLanguage, "scala3-upickle"),
    new JSONFixture(languages.KotlinJacksonLanguage, "kotlin-jackson"),
    new JSONFixture(languages.KotlinXLanguage, "kotlinx"),
    new JSONFixture(languages.DartLanguage),
    new JSONFixture(languages.PikeLanguage),
    new JSONFixture(languages.HaskellLanguage),
    new JSONFixture(languages.ElixirLanguage),
    new JSONSchemaJSONFixture(languages.CSharpLanguage),
    new JSONTypeScriptFixture(languages.CSharpLanguage),
    // new JSONSchemaFixture(languages.CrystalLanguage),
    new JSONSchemaFixture(languages.JSONSchemaLanguage),
    new JSONSchemaFixture(languages.CSharpLanguage),
    new JSONSchemaFixture(
        languages.CSharpLanguageSystemTextJson,
        "schema-csharp-SystemTextJson",
    ),
    new JSONSchemaFixture(languages.JavaLanguage),
    new JSONSchemaFixture(
        languages.JavaLanguageWithLegacyDateTime,
        "schema-java-datetime-legacy",
    ),
    new JSONSchemaFixture(
        languages.JavaLanguageWithLombok,
        "schema-java-lombok",
    ),
    new JSONSchemaFixture(languages.GoLanguage),
    new LeadingCommentsGoFixture(),
    new JSONSchemaFixture(languages.CJSONLanguage),
    new JSONSchemaFixture(languages.CPlusPlusLanguage),
    new JSONSchemaFixture(languages.RustLanguage),
    new JSONSchemaFixture(languages.RubyLanguage),
    new JSONSchemaFixture(languages.PythonLanguage),
    new JSONSchemaFixture(languages.PHPLanguage),
    new JSONSchemaFixture(languages.ElmLanguage),
    new JSONSchemaFixture(languages.SwiftLanguage),
    new JSONSchemaFixture(languages.TypeScriptLanguage),
    new JSONSchemaFixture(languages.TypeScriptZodLanguage),
    new JSONSchemaFixture(languages.FlowLanguage),
    new JSONSchemaFixture(languages.JavaScriptLanguage),
    new JSONSchemaFixture(languages.KotlinLanguage),
    new JSONSchemaFixture(
        languages.KotlinJacksonLanguage,
        "schema-kotlin-jackson",
    ),
    new JSONSchemaFixture(languages.KotlinXLanguage, "schema-kotlinx"),
    new JSONSchemaFixture(languages.Scala3Language),
    new JSONSchemaFixture(
        languages.Scala3UpickleLanguage,
        "schema-scala3-upickle",
    ),
    new JSONSchemaFixture(languages.DartLanguage),
    new JSONSchemaFixture(languages.PikeLanguage),
    new JSONSchemaFixture(languages.HaskellLanguage),
    new JSONSchemaFixture(languages.ElixirLanguage),
    new CommentInjectionSchemaFixture(languages.TypeScriptLanguage),
    new CommentInjectionSchemaFixture(languages.ObjectiveCLanguage),
    new CommentInjectionSchemaFixture(languages.TypeScriptZodLanguage, [
        "test/inputs/schema/comment-injection-enum.schema",
        "test/inputs/schema/comment-injection-enum-nested-comment.schema",
    ]),
    new CommentInjectionSchemaFixture(
        languages.TypeScriptEffectSchemaLanguage,
        [
            "test/inputs/schema/comment-injection-enum.schema",
            "test/inputs/schema/comment-injection-enum-nested-comment.schema",
        ],
    ),
    new CommentInjectionTreeSitterFixture(),
    // FIXME: Why are we missing so many language with GraphQL?
    new GraphQLFixture(languages.CSharpLanguage),
    new GraphQLFixture(languages.JavaLanguage),
    new GraphQLFixture(
        languages.JavaLanguageWithLegacyDateTime,
        false,
        "graphql-java-datetime-legacy",
    ),
    new GraphQLFixture(
        languages.JavaLanguageWithLombok,
        false,
        "graphql-java-lombok",
    ),
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
    new GraphQLFixture(languages.ElixirLanguage),
    new CommandSuccessfulLanguageFixture(languages.JavaScriptPropTypesLanguage),
];
