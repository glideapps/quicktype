#!/usr/bin/env node

const Ajv = require('ajv');
const fs = require("fs");
const _ = require("lodash");
const path = require("path");
const shell = require("shelljs");
const deepEquals = require("./deepEquals");
const Main = require("../output/Main");
const Samples = require("../output/Samples");
const { inParallel } = require("./multicore");
const os = require("os");

const IS_CI = process.env.CI === "true";
const BRANCH = process.env.TRAVIS_BRANCH;
const IS_BLESSED = ["master"].indexOf(BRANCH) !== -1;
const IS_PUSH = process.env.TRAVIS_EVENT_TYPE === "push";
const IS_PR = process.env.TRAVIS_PULL_REQUEST && process.env.TRAVIS_PULL_REQUEST !== "false";

const CPUs = IS_CI
    ? 2 /* Travis has only 2 but reports 8 */
    : os.cpus().length;

const QUICKTYPE_CLI = path.resolve("./cli/quicktype.js");

const knownGoFails = ["identifiers.json"];
const goWillFail = (sample) => knownGoFails.indexOf(path.basename(sample)) !== -1;

const FIXTURES = [
    {
        name: "csharp",
        base: "test/csharp",
        setup: "dotnet restore",
        test: (sample) => {
            quicktype(`--srcLang json -o QuickType.cs --src ${sample}`);
            generateJSONAndCompareToFile(`dotnet run "${sample}"`, sample);
        }
    },
    {
        name: "golang",
        base: "test/golang",
        test: (sample) => {
            quicktype(`--srcLang json -o quicktype.go --src ${sample}`);

            if (goWillFail(sample)) {
                console.error("Known to fail - not checking output.");
            } else {
                generateJSONAndCompareToFile(`go run main.go quicktype.go < "${sample}"`, sample);
            }
        }
    },
    {
        name: "json-schema",
        base: "test/golang",
        test: validateJSONSchema
    }
];

function exec(s, opts, cb) {
    let result = shell.exec(s, opts, cb);
    if (result.code !== 0) {
        console.error(`Error: Command failed: ${s}`);
        console.error(result.stdout);
        console.error(result.stderr);
        shell.exit(result.code);
    }
    return result;
}

function generateJSONAndCompareToFile(jsonGeneratingCommand, expectedOutputFile) {
    let outputString = exec(jsonGeneratingCommand, {silent: true}).stdout;
    let outputJSON = JSON.parse(outputString);
    let inputJSON = JSON.parse(fs.readFileSync(expectedOutputFile));
    if (!deepEquals(inputJSON, outputJSON)) {
        console.error("Error: Output is not equivalent to input.");
        process.exit(1);
    }
}

function quicktype(args) {
    exec(`node ${QUICKTYPE_CLI} ${args}`);    
}

function validateJSONSchema(sample) {
    let input = JSON.parse(fs.readFileSync(sample));

    quicktype(`--srcLang json -o schema.json --src ${sample}`);
    let schema = JSON.parse(fs.readFileSync("schema.json"));
    
    let ajv = new Ajv();
    let valid = ajv.validate(schema, input);
    if (!valid) {
        console.error("Error: Generated schema does not validate input JSON.");
        process.exit(1);
    }
    
    // Turn the generated schema into Go
    quicktype(`--srcLang json-schema -o quicktype.go --src schema.json`);

    if (goWillFail(sample)) {
        console.error("Known to fail - not checking output.");
    } else {
        // Parse the infile with Go generated from its schema, and compare to the infile
        generateJSONAndCompareToFile(`go run main.go quicktype.go < "${sample}"`, sample);
    }
}

function inDir(dir, work) {
    let origin = process.cwd();
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
    inDir(tmp, () => fixture.test(sampleAbs));
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
                inDir(base, () => exec(setup));
            });
        },
        work: ({ sample, fixtureName }, i) => {
            console.error(`* [${i+1}/${tests.length}] ${fixtureName} ${sample}`);

            let fixture = _.find(FIXTURES, { name: fixtureName });
            runFixtureWithSample(fixture, sample);
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
