#!/usr/bin/env node 

const Ajv = require('ajv');
const strictDeepEquals = require('deep-equal');
const fs = require("fs");
const _ = require("lodash");
const path = require("path");
const shell = require("shelljs");
const deepEquals = require("./deepEquals");
const Main = require("../output/Main");
const Samples = require("../output/Samples");
const assert = require("assert");
const { inParallel } = require("./multicore");
const os = require("os");
const exit = require('exit');

//////////////////////////////////////
// Constants
/////////////////////////////////////

function debug(x) {
    if (!process.env.DEBUG) return;
    console.log(x);
    return x;
}

const IS_CI = process.env.CI === "true";
const BRANCH = process.env.TRAVIS_BRANCH;
const IS_BLESSED = ["master"].indexOf(BRANCH) !== -1;
const IS_PUSH = process.env.TRAVIS_EVENT_TYPE === "push";
const IS_PR = process.env.TRAVIS_PULL_REQUEST && process.env.TRAVIS_PULL_REQUEST !== "false";

const CPUs = IS_CI
    ? 2 /* Travis has only 2 but reports 8 */
    : process.env.CPUs || os.cpus().length;

const QUICKTYPE_CLI = path.resolve("./cli/quicktype.js");

const NODE_BIN = path.resolve("./node_modules/.bin");
process.env.PATH += `:${NODE_BIN}`;

//////////////////////////////////////
// Fixtures
/////////////////////////////////////

const FIXTURES = [
    {
        name: "csharp",
        base: "test/csharp",
        setup: "dotnet restore",
        diffViaSchema: false,
        output: "QuickType.cs",
        test: testCSharp
    },
    {
        name: "golang",
        base: "test/golang",
        diffViaSchema: true,
        output: "quicktype.go",
        test: testGo
    },
    {
        name: "json-schema",
        base: "test/golang",
        diffViaSchema: false,
        output: "schema.json",
        test: testJsonSchema
    },
    {
        name: "elm",
        base: "test/elm",
        setup: "elm-make --yes",
        diffViaSchema: false,
        output: "QuickType.elm",
        test: testElm
    }
].filter(({name}) => !process.env.FIXTURE || name === process.env.FIXTURE);

//////////////////////////////////////
// Go tests
/////////////////////////////////////

const knownUnicodeFails = ["identifiers.json"];
const unicodeWillFail = (sample) => knownUnicodeFails.indexOf(path.basename(sample)) !== -1;

function testGo(sample) {
    if (unicodeWillFail(sample)) {
        console.error(`Skipping golang ${sample} – known to fail`);
        return;
    }

    compareJsonFileToJson({
        expectedFile: sample,
        jsonCommand: `go run main.go quicktype.go < "${sample}"`,
        strict: false
    });
}

//////////////////////////////////////
// C# tests
/////////////////////////////////////

function testCSharp(sample) {
    compareJsonFileToJson({
        expectedFile: sample,
        jsonCommand: `dotnet run "${sample}"`,
        strict: false
    });
}

//////////////////////////////////////
// Elm tests
/////////////////////////////////////

function testElm(sample) {
    if (unicodeWillFail(sample)) {
        console.error(`Skipping elm ${sample} – known to fail`);
        return;
    }

    exec("elm-make Main.elm QuickType.elm --output elm.js");
    exec(`node ./runner.js "${sample}"`)
}

//////////////////////////////////////
// JSON Schema tests
/////////////////////////////////////

function testJsonSchema(sample) {
    let input = JSON.parse(fs.readFileSync(sample));
    let schema = JSON.parse(fs.readFileSync("schema.json"));
    
    let ajv = new Ajv();
    let valid = ajv.validate(schema, input);
    if (!valid) {
        failWith({
            sample,
            error: "Generated schema does not validate input JSON.",
        });
    }

    // Generate Go from the schema
    exec(`quicktype --srcLang json-schema -o quicktype.go --src schema.json`);

    // Possibly check the output of the Go program against the sample
    if (goWillFail(sample)) {
        console.error("Known to fail - not checking output.");
    } else {
        // Parse the sample with Go generated from its schema, and compare to the sample
        compareJsonFileToJson({
            expectedFile: sample,
            jsonCommand: `go run main.go quicktype.go < "${sample}"`,
            strict: false
        });
    }
    
    // Generate a schema from the schema, making sure the schemas are the same
    compareJsonFileToJson({
        expectedFile: "schema.json",
        jsonCommand: `quicktype --srcLang json-schema --src schema.json --lang json`,
        strict: true
    });
}

//////////////////////////////////////
// Test driver
/////////////////////////////////////

function failWith(obj) {
    obj.cwd = process.cwd();
    console.error(JSON.stringify(obj, null, "  "));
    throw obj;
}

function exec(s, opts, cb) {
    // We special-case quicktype execution
    s = s.replace(/^quicktype /, `node ${QUICKTYPE_CLI} `);

    debug(s);

    let result = shell.exec(s, opts, cb);
    if (result.code !== 0) {
        console.error(result.stdout);
        console.error(result.stderr);
        failWith({
            command: s,
            code: result.code
        });
    }
    return result;
}

function compareJsonFileToJson({expectedFile, jsonFile, jsonCommand, strict}) {
    debug({expectedFile, jsonFile, jsonCommand, strict});

    let jsonString = jsonFile
        ? fs.readFileSync(jsonFile)
        : exec(jsonCommand, {silent: true}).stdout;

    let givenJSON = JSON.parse(jsonString);
    let expectedJSON = JSON.parse(fs.readFileSync(expectedFile));
    
    let jsonAreEqual = strict
        ? strictDeepEquals(givenJSON, expectedJSON)
        : deepEquals(expectedJSON, givenJSON, []);

    if (!jsonAreEqual) {
        console.error("Error: Output is not equivalent to input.");
        failWith({
            expectedFile,
            jsonCommand,
            jsonFile
        });
    }
}

function inDir(dir, work) {
    let origin = process.cwd();
    
    debug(`cd ${dir}`)
    process.chdir(dir);

    work();
    process.chdir(origin);
}

function runFixtureWithSample(fixture, sample) {
    let tmp = path.resolve(os.tmpdir(), require("crypto").randomBytes(8).toString('hex'));
    let sampleAbs = path.resolve(sample);

    let stats = fs.statSync(sampleAbs);
    if (stats.size > 32 * 1024 * 1024) {
        console.error(`* Skipping ${sampleAbs} because it's too large`);
        return;
    }

    shell.cp("-R", fixture.base, tmp);

    inDir(tmp, () => {
        // Generate code from the sample
        exec(`quicktype --src ${sampleAbs} --srcLang json -o ${fixture.output}`);

        fixture.test(sampleAbs);

        if (fixture.diffViaSchema) {
            debug("* Diffing with code generated via JSON Schema");
            // Make a schema
            exec(`quicktype --src ${sampleAbs} --srcLang json -o schema.json`);
            // Quicktype from the schema and compare to expected code
            shell.mv(fixture.output, `${fixture.output}.expected`);
            exec(`quicktype --src schema.json --srcLang json-schema -o ${fixture.output}`);

            // Compare fixture.output to fixture.output.expected
            try {
                exec(`diff -Naur ${fixture.output}.expected ${fixture.output}`);
            } catch ({ command }) {
                // FIXME: Set this to fail once we have it working.  See issue #59.
                console.error(`Command failed, but we're allowing it: ${command}`);
            }
        }
    });
}

function testAll(samples) {
    // Get an array of all { sample, fixtureName } objects we'll run
    let tests =  _
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
            FIXTURES.forEach(({ name, base, setup }) => {
                if (!setup) return;
                console.error(`* Setting up ${name} fixture`);
                inDir(base, () => exec(setup, { silent: true }));
            });
        },
        work: ({ sample, fixtureName }, i) => {
            console.error(`* [${i+1}/${tests.length}] ${fixtureName} ${sample}`);

            let fixture = _.find(FIXTURES, { name: fixtureName });
            try {
                runFixtureWithSample(fixture, sample);
            } catch (e) {
                exit(1);
            }
        }
    });
}

function testsInDir(dir) {
    return shell.ls(`${dir}/*.json`);
}

function main(sources) {
    if (sources.length == 0) {
        if (IS_CI && !IS_PR && !IS_BLESSED) {
            return main(testsInDir("app/public/sample/json"));
        } else {
            return main(testsInDir("test/inputs/json"));
        }
    } else if (sources.length == 1 && fs.lstatSync(sources[0]).isDirectory()) {
        return main(testsInDir(sources[0]));
    } else {
        testAll(sources);
    }
}

// skip 2 `node` args
main(process.argv.slice(2));
