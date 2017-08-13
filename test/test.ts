#!/usr/bin/env ts-node

import * as process from "process";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as _ from "lodash";

import { inParallel } from "./lib/multicore";
import deepEquals from "./lib/deepEquals";
import { randomBytes } from "crypto";

const Ajv = require('ajv');
const strictDeepEquals: (x: any, y: any) => boolean = require('deep-equal');
const shell = require("shelljs");

const Main = require("../output/Main");
const Samples = require("../output/Samples");

const exit = require('exit');
const chalk = require("chalk");

//////////////////////////////////////
// Constants
/////////////////////////////////////

function debug<T>(x: T): T {
    if (!process.env.DEBUG) return;
    console.log(x);
    return x;
}

const IS_CI = process.env.CI === "true";
const BRANCH = process.env.TRAVIS_BRANCH;
const IS_BLESSED = ["master"].indexOf(BRANCH) !== -1;
const IS_PUSH = process.env.TRAVIS_EVENT_TYPE === "push";
const IS_PR = process.env.TRAVIS_PULL_REQUEST && process.env.TRAVIS_PULL_REQUEST !== "false";
const DEBUG = typeof process.env.DEBUG !== 'undefined';

const CPUs = IS_CI
    ? 2 /* Travis has only 2 but reports 8 */
    : +process.env.CPUs || os.cpus().length;

const QUICKTYPE_CLI = path.resolve("./cli/dist/quicktype.js");

const NODE_BIN = path.resolve("./node_modules/.bin");
process.env.PATH += `:${NODE_BIN}`;

process.env.NODE_PATH = path.resolve("./node_modules");

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
    test: (sample: string) => void;
}

const FIXTURES: Fixture[] = [
    {
        name: "csharp",
        base: "test/fixtures/csharp",
        setup: "dotnet restore",
        diffViaSchema: false,
        output: "QuickType.cs",
        topLevel: "QuickType",
        test: testCSharp
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
        setup: IS_CI
                ? "./setup-ci.sh"
                : "rm -rf elm-stuff/build-artifacts && elm-make --yes",
        diffViaSchema: false,
        output: "QuickType.elm",
        topLevel: "QuickType",
        test: testElm,
        skip: [
            "identifiers.json",
            "simple-identifiers.json"
        ]
    },
    {
        name: "typescript",
        base: "test/fixtures/typescript",
        diffViaSchema: false,
        output: "TopLevel.ts",
        topLevel: "TopLevel",
        test: testTypeScript,
        skip: [
            "identifiers.json"
        ]
    }
].filter(({name}) => !process.env.FIXTURE || name === process.env.FIXTURE);

//////////////////////////////////////
// Go tests
/////////////////////////////////////

function testGo(sample: string) {
    compareJsonFileToJson({
        expectedFile: sample,
        jsonCommand: `go run main.go quicktype.go < "${sample}"`,
        strict: false
    });
}

//////////////////////////////////////
// C# tests
/////////////////////////////////////

function testCSharp(sample: string) {
    compareJsonFileToJson({
        expectedFile: sample,
        jsonCommand: `dotnet run "${sample}"`,
        strict: false
    });
}

//////////////////////////////////////
// Elm tests
/////////////////////////////////////

function testElm(sample: string) {
    let limit_cpus = IS_CI ? "$TRAVIS_BUILD_DIR/sysconfcpus/bin/sysconfcpus -n 2" : "";
    exec(`${limit_cpus} elm-make Main.elm QuickType.elm --output elm.js`);

    compareJsonFileToJson({
        expectedFile: sample,
        jsonCommand: `node ./runner.js "${sample}"`,
        strict: false
    });
}

//////////////////////////////////////
// JSON Schema tests
/////////////////////////////////////

function testJsonSchema(sample: string) {
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
    exec(`quicktype --src-lang schema -o quicktype.go --top-level TopLevel --src schema.json`);

    // Parse the sample with Go generated from its schema, and compare to the sample
    compareJsonFileToJson({
        expectedFile: sample,
        jsonCommand: `go run main.go quicktype.go < "${sample}"`,
        strict: false
    });
    
    // Generate a schema from the schema, making sure the schemas are the same
    compareJsonFileToJson({
        expectedFile: "schema.json",
        jsonCommand: `quicktype --src-lang schema --src schema.json --lang schema`,
        strict: true
    });
}

//////////////////////////////////////
// TypeScript test
/////////////////////////////////////

function testTypeScript(sample) {
    compareJsonFileToJson({
        expectedFile: sample,
        jsonCommand: `ts-node main.ts \"${sample}\"`,
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

function exec(
    s: string,
    opts: { silent: boolean } = { silent: !DEBUG },
    cb?: any)
    : { stdout: string; code: number; } {

    // We special-case quicktype execution
    s = s.replace(/^quicktype/, QUICKTYPE_CLI);

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

    debug({ jsonString });

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

function inDir(dir: string, work: () => void) {
    let origin = process.cwd();
    
    debug(`cd ${dir}`)
    process.chdir(dir);
    
    work();
    process.chdir(origin);
}

function runFixtureWithSample(fixture: Fixture, sample: string, index: number, total: number) {          
    let cwd = `test/runs/${fixture.name}-${randomBytes(3).toString('hex')}`;
    let sampleFile = path.basename(sample);

    console.error(
        `*`,
        chalk.dim(`[${index+1}/${total}]`),
        chalk.magenta(fixture.name),
        path.join(
            cwd,
            chalk.cyan(path.basename(sample))));

    if (fs.statSync(sample).size > 32 * 1024 * 1024) {
        console.error(`* Skipping ${sample} because it's too large`);
        return;
    }

    let skips = fixture.skip || [];
    if (skips.indexOf(sampleFile) != -1) {
        console.error(`* Skipping ${sampleFile} – known to fail`);
        return;
    }

    shell.cp("-R", fixture.base, cwd);
    shell.cp(sample, cwd);

    inDir(cwd, () => {
        let sampleFile = path.basename(sample);
        // Generate code from the sample
        exec(`quicktype --src ${sampleFile} --out ${fixture.output} --top-level ${fixture.topLevel}`);

        fixture.test(sampleFile);

        if (fixture.diffViaSchema) {
            debug("* Diffing with code generated via JSON Schema");
            // Make a schema
            exec(`quicktype --src ${sampleFile} -o schema.json`);
            // Quicktype from the schema and compare to expected code
            shell.mv(fixture.output, `${fixture.output}.expected`);
            exec(`quicktype --src schema.json --src-lang schema -o ${fixture.output}`);

            // Compare fixture.output to fixture.output.expected
            try {
                exec(`diff -Naur ${fixture.output}.expected ${fixture.output} > /dev/null 2>&1`);
            } catch ({ command }) {
                // FIXME: Set this to fail once we have it working.  See issue #59.
                console.error(`Command failed but we're allowing it`);
            }
        }
    });

    shell.rm("-rf", cwd);
}

function testAll(samples: string[]) {
    // Get an array of all { sample, fixtureName } objects we'll run
    let tests: { sample: string; fixtureName: string }[] =  _
        .chain(FIXTURES)
        .flatMap((fixture) => samples.map((sample) => { 
            return { sample, fixtureName: fixture.name };
        }))
        .shuffle()
        .value();
    
    inParallel({
        queue: tests,
        workers: CPUs,
        setup: () => {
            exec(`cd cli && script/build.ts`);

            FIXTURES.forEach(({ name, base, setup }) => {
                exec(`rm -rf test/runs`);
                exec(`mkdir -p test/runs`);

                if (setup) {
                    console.error(
                        `* Setting up`,
                        chalk.magenta(name),
                        `fixture`);

                    inDir(base, () => exec(setup));
                }
            });
        },
        work: ({ sample, fixtureName }, index) => {
            let fixture = _.find(FIXTURES, { name: fixtureName });
            try {
                runFixtureWithSample(fixture, sample, index, tests.length);
            } catch (e) {
                console.trace();
                exit(1);
            }
        }
    });
}

function testsInDir(dir: string): string[] {
    return shell.ls(`${dir}/*.json`);
}

function changedFiles(): string[] {
    let diff = exec("git diff --name-only $TRAVIS_COMMIT_RANGE").stdout;
    return diff.trim().split("\n");
}

const testSkippingCriteria = {
    "Only app/ paths changed"(changed: string[]) {
        return _.every(changed, (file) => _.startsWith(file, "app/"));
    },
    "Only cli/README.json changed"(changed: string[]) {
        return _.without(changed, "cli/README.md").length === 0;
    }
};

function shouldSkipTests(): boolean {
    try {
        if (IS_CI && process.env.TRAVIS_COMMIT_RANGE) {
            let changed = changedFiles();
            for (let reason of Object.keys(testSkippingCriteria)) {
                if (testSkippingCriteria[reason](changed)) {
                    console.error(`* ${reason}; skipping tests.`);
                    return true;
                }
            }            
        }
    } catch (e) {
    }
    return false;
}

function main(sources: string[]) {
    if (shouldSkipTests()) {
        return;
    }

    if (sources.length == 0) {
        sources = testsInDir("test/inputs/json");
    }

    if (IS_CI && !IS_PR && !IS_BLESSED) {
        // Run just a few random samples on low-priority CI branches
        sources = _.chain(sources).shuffle().take(3).value();
    }
    
    if (sources.length == 1 && fs.lstatSync(sources[0]).isDirectory()) {
        sources = testsInDir(sources[0]);
    }

    testAll(sources);
}

// skip 2 `node` args
main(process.argv.slice(2));
