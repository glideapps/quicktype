import * as process from "process";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as _ from "lodash";

import { main as quicktype_, Options } from "../cli/quicktype";

import { inParallel } from "./lib/multicore";
import deepEquals from "./lib/deepEquals";
import { randomBytes } from "crypto";

const Ajv = require('ajv');
const strictDeepEquals: (x: any, y: any) => boolean = require('deep-equal');
const shell = require("shelljs");

const Main = require("../output/purs/Main");
const Samples = require("../output/purs/Samples");

const exit = require('exit');
const chalk = require("chalk");

//////////////////////////////////////
// Constants
/////////////////////////////////////

const IS_CI = process.env.CI === "true";
const BRANCH = process.env.TRAVIS_BRANCH;
const IS_BLESSED = ["master"].indexOf(BRANCH) !== -1;
const IS_PUSH = process.env.TRAVIS_EVENT_TYPE === "push";
const IS_PR = process.env.TRAVIS_PULL_REQUEST && process.env.TRAVIS_PULL_REQUEST !== "false";
const DEBUG = typeof process.env.DEBUG !== 'undefined';

const CPUs = +process.env.CPUs || os.cpus().length;

function debug<T>(x: T): T {
    if (DEBUG) console.log(x);
    return x;
}

//////////////////////////////////////
// Fixtures
/////////////////////////////////////

interface Fixture {
    name: string;
    base: string;
    setup?: string;
    diffViaSchema: boolean;
    output: string;
    topLevel: string;
    skip?: string[]
    test(sample: string): Promise<void>;
}

const FIXTURES: Fixture[] = [
    {
        name: "csharp",
        base: "test/fixtures/csharp",
        // https://github.com/dotnet/cli/issues/1582
        setup: "dotnet restore --no-cache",
        diffViaSchema: true,
        output: "QuickType.cs",
        topLevel: "QuickType",
        test: testCSharp
    },
    {
        name: "java",
        base: "test/fixtures/java",
        diffViaSchema: false,
        output: "src/main/java/io/quicktype/TopLevel.java",
        topLevel: "TopLevel",
        test: testJava,
        skip: [
            "identifiers.json",
            "simple-identifiers.json"
        ]
    },
    {
        name: "golang",
        base: "test/fixtures/golang",
        diffViaSchema: true,
        output: "quicktype.go",
        topLevel: "TopLevel",
        test: testGo,
        skip: [
            "identifiers.json",
            "simple-identifiers.json"
        ]
    },
    {
        name: "schema",
        base: "test/fixtures/golang",
        diffViaSchema: false,
        output: "schema.json",
        topLevel: "schema",
        test: testJsonSchema,
        skip: [
            "identifiers.json",
            "simple-identifiers.json"
        ]
    },
    {
        name: "elm",
        base: "test/fixtures/elm",
        setup: "rm -rf elm-stuff/build-artifacts && elm-make --yes",
        diffViaSchema: true,
        output: "QuickType.elm",
        topLevel: "QuickType",
        test: testElm,
        skip: [
            "identifiers.json",
            "simple-identifiers.json"
        ]
    },
    {
        name: "swift",
        base: "test/fixtures/swift",
        diffViaSchema: false,
        output: "quicktype.swift",
        topLevel: "TopLevel",
        test: testSwift,
        skip: [
            "identifiers.json",
            "no-classes.json"
        ]
    },
    {
        name: "typescript",
        base: "test/fixtures/typescript",
        diffViaSchema: true,
        output: "TopLevel.ts",
        topLevel: "TopLevel",
        test: testTypeScript,
        skip: [
            "identifiers.json"
        ]
    }
].filter(({name}) => !process.env.FIXTURE || process.env.FIXTURE.includes(name));

//////////////////////////////////////
// Go tests
/////////////////////////////////////

async function testGo(sample: string) {
    compareJsonFileToJson({
        expectedFile: sample,
        jsonCommand: `go run main.go quicktype.go < "${sample}"`,
        strict: false
    });
}

//////////////////////////////////////
// C# tests
/////////////////////////////////////

async function testCSharp(sample: string) {
    compareJsonFileToJson({
        expectedFile: sample,
        jsonCommand: `dotnet run "${sample}"`,
        strict: false
    });
}

//////////////////////////////////////
// Java tests
/////////////////////////////////////

async function testJava(sample: string) {
    exec(`mvn package`);
    compareJsonFileToJson({
        expectedFile: sample,
        jsonCommand: `java -cp target/QuickTypeTest-1.0-SNAPSHOT.jar io.quicktype.App "${sample}"`,
        strict: false
    });
}

//////////////////////////////////////
// Elm tests
/////////////////////////////////////

async function testElm(sample: string) {
    exec(`elm-make Main.elm QuickType.elm --output elm.js`);

    compareJsonFileToJson({
        expectedFile: sample,
        jsonCommand: `node ./runner.js "${sample}"`,
        strict: false
    });
}

//////////////////////////////////////
// Swift tests
/////////////////////////////////////

async function testSwift(sample: string) {
    exec(`swiftc -o quicktype main.swift quicktype.swift`);
    compareJsonFileToJson({
        expectedFile: sample,
        jsonCommand: `./quicktype "${sample}"`,
        strict: false
    });
}

//////////////////////////////////////
// JSON Schema tests
/////////////////////////////////////

async function testJsonSchema(sample: string) {
    let input = JSON.parse(fs.readFileSync(sample, "utf8"));
    let schema = JSON.parse(fs.readFileSync("schema.json", "utf8"));
    
    let ajv = new Ajv();
    let valid = ajv.validate(schema, input);
    if (!valid) {
        failWith("Generated schema does not validate input JSON.", {
            sample
        });
    }

    // Generate Go from the schema
    await quicktype({ src: ["schema.json"], srcLang: "schema", out: "quicktype.go", topLevel: "TopLevel" });

    // Parse the sample with Go generated from its schema, and compare to the sample
    compareJsonFileToJson({
        expectedFile: sample,
        jsonCommand: `go run main.go quicktype.go < "${sample}"`,
        strict: false
    });
    
    // Generate a schema from the schema, making sure the schemas are the same
    let schemaSchema = "schema-from-schema.json";
    await quicktype({ src: ["schema.json"], srcLang: "schema", lang: "schema", out: schemaSchema });
    compareJsonFileToJson({
        expectedFile: "schema.json",
        jsonFile: schemaSchema,
        strict: true
    });
}

//////////////////////////////////////
// TypeScript test
/////////////////////////////////////

async function testTypeScript(sample) {
    compareJsonFileToJson({
        expectedFile: sample,
        // We have to unset TS_NODE_PROJECT because it gets set on the workers
        // to the root test/tsconfig.json
        jsonCommand: `TS_NODE_PROJECT= ts-node main.ts \"${sample}\"`,
        strict: false
    });
}

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
    let [_, duration] = await time(async () => {    
        await quicktype_(opts);
    });
}

function exec(
    s: string,
    opts: { silent: boolean } = { silent: !DEBUG },
    cb?: any)
    : { stdout: string; code: number; } {

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

type ComparisonArgs = {
    expectedFile: string;
    jsonFile?: string;
    jsonCommand?: string;
    strict: boolean
};

function compareJsonFileToJson(args: ComparisonArgs) {
    debug(args);

    let { expectedFile, jsonFile, jsonCommand, strict } = args;

    let jsonString = jsonFile
        ? fs.readFileSync(jsonFile, "utf8")
        : exec(jsonCommand).stdout;

    let givenJSON = JSON.parse(jsonString);
    let expectedJSON = JSON.parse(fs.readFileSync(expectedFile, "utf8"));
    
    let jsonAreEqual = strict
        ? strictDeepEquals(givenJSON, expectedJSON)
        : deepEquals(expectedJSON, givenJSON);

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
    
    debug(`cd ${dir}`)
    process.chdir(dir);
    
    await work();
    process.chdir(origin);
}

function shouldSkipTest(fixture: Fixture, sample: string): boolean {
    if (fs.statSync(sample).size > 32 * 1024 * 1024) {
        return true;
    }
    let skips = fixture.skip || [];
    return _.includes(skips, path.basename(sample));
}

async function runFixtureWithSample(fixture: Fixture, sample: string, index: number, total: number) {          
    let cwd = `test/runs/${fixture.name}-${randomBytes(3).toString('hex')}`;
    let sampleFile = path.basename(sample);
    let shouldSkip = shouldSkipTest(fixture, sample);

    console.error(
        `*`,
        chalk.dim(`[${index+1}/${total}]`),
        chalk.magenta(fixture.name),
        path.join(
            cwd,
            chalk.cyan(path.basename(sample))),
        shouldSkip
            ? chalk.red("SKIP")
            : '');

    if (shouldSkip) return;

    shell.cp("-R", fixture.base, cwd);
    shell.cp(sample, cwd);

    await inDir(cwd, async () => {
        // Generate code from the sample
        await quicktype({ src: [sampleFile], out: fixture.output, topLevel: fixture.topLevel});

        await fixture.test(sampleFile);

        if (fixture.diffViaSchema) {
            debug("* Diffing with code generated via JSON Schema");
            // Make a schema
            await quicktype({ src: [sampleFile], out: "schema.json", topLevel: fixture.topLevel});
            // Quicktype from the schema and compare to expected code
            shell.mv(fixture.output, `${fixture.output}.expected`);
            await quicktype({ src: ["schema.json"], srcLang: "schema", out: fixture.output, topLevel: fixture.topLevel});

            // Compare fixture.output to fixture.output.expected
            exec(`diff -Naur ${fixture.output}.expected ${fixture.output} > /dev/null 2>&1`);
        }
    });

    shell.rm("-rf", cwd);
}

type WorkItem = { sample: string; fixtureName: string; }

async function testAll(samples: string[]) {
    // Get an array of all { sample, fixtureName } objects we'll run
    let tests =  _
        .chain(samples)
        .flatMap(sample => FIXTURES.map(fixture => { 
            return { sample, fixtureName: fixture.name };
        }))
        .value();
    
    await inParallel({
        queue: tests,
        workers: CPUs,

        setup: async () => {
            testCLI();

            console.error(`* Running ${samples.length} tests on ${FIXTURES.length} fixtures`);

            for (let { name, base, setup } of FIXTURES) {
                exec(`rm -rf test/runs`);
                exec(`mkdir -p test/runs`);

                if (setup) {
                    console.error(
                        `* Setting up`,
                        chalk.magenta(name),
                        `fixture`);

                    await inDir(base, async () => { exec(setup); });
                }
            }
        },

        map: async ({ sample, fixtureName }: WorkItem, index) => {
            let fixture = _.find(FIXTURES, { name: fixtureName });
            try {
                await runFixtureWithSample(fixture, sample, index, tests.length);
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

function testsInDir(dir: string): string[] {
    return shell.ls(`${dir}/*.json`);
}

async function main(sources: string[]) {
    let prioritySources = _.concat(
        testsInDir("test/inputs/json/priority"),
        testsInDir("test/inputs/json/samples"),
    );

    let miscSources = testsInDir("test/inputs/json/misc");

    if (sources.length == 0) {
        sources = _.concat(
            prioritySources,
            _.shuffle(miscSources)
        );
    } else if (sources.length == 1 && fs.lstatSync(sources[0]).isDirectory()) {
        sources = testsInDir(sources[0]);
    }

    if (IS_CI && !IS_PR && !IS_BLESSED) {
        // Run only priority sources on low-priority CI branches
        sources = prioritySources;
    } else if (IS_CI) {
        // On CI, we run a maximum number of test samples. First we test
        // the priority samples to fail faster, then we continue testing
        // until testMax with random sources.
        let testMax = 100;
        sources = _.concat(
            prioritySources,
            _.chain(miscSources).shuffle().take(testMax - prioritySources.length).value()
        );
    }

    await testAll(sources);
}

// skip 2 `node` args
main(process.argv.slice(2)).catch(reason => {
    console.error(reason);
    process.exit(1);
});
