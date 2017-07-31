#!/usr/bin/env node

const Ajv = require('ajv');
const fs = require("fs");
const path = require("path");
const shell = require("shelljs");
const deepEquals = require("./deepEquals");
const Main = require("../output/Main");
const Samples = require("../output/Samples");

const IsCI = process.env.CI === "true";
const Branch = process.env.TRAVIS_BRANCH;
const IsBlessed = ["master"].indexOf(Branch) !== -1;
const IsPush = process.env.TRAVIS_EVENT_TYPE === "push";
const IsPR = process.env.TRAVIS_PULL_REQUEST && process.env.TRAVIS_PULL_REQUEST !== "false";

function pathToString(path) {
    return path.join(".");
}

function exec(s, opts, cb) {
    let result = shell.exec(s, opts, cb);
    if (result.code !== 0) {
        console.error(`Error: Command failed: ${s}`);
        shell.exit(result.code);
    }
    return result;
}

function execAndCompare(cmd, p, knownFails) {
    let outputString = exec(cmd, {silent:true}).stdout;
    if (knownFails.indexOf(path.basename(p)) < 0) {
        let outputJSON = JSON.parse(outputString);
        let inputJSON = JSON.parse(fs.readFileSync(p));
        if (!deepEquals(inputJSON, outputJSON, [])) {
            console.error("Error: Output is not equivalent to input.");
            process.exit(1);
        }
    } else {
        console.log("Known to fail - not checking output.");
    }
}

function absolutize(p) {
    if (path.isAbsolute(p))
        return p;
    return path.join(process.cwd(), p);
}

function execQuicktype(source, output, sourceLanguage) {
    exec(`node ../../cli/quicktype.js --srcLang "${sourceLanguage}" -o "${output}" "${source}"`);    
}

function runTests(description, samples, dir, prepareCmd, filename, testFn) {
    shell.cd(dir);
    if (prepareCmd)
        shell.exec(prepareCmd, { silent: true });
    
    samples.forEach((sample) => {
        let stats = fs.statSync(sample);
        if (stats.size > 32 * 1024 * 1024) {
            console.log(`* Skipping ${sample} because it's too large`);
            return;
        }
        console.error(`* Building ${description} for ${sample}`);
        execQuicktype(sample, filename, "json");
        testFn(sample);
    });
    
    shell.cd("../..");
}

function testCSharp(samples, knownFails) {
    runTests("C# code", samples, "test/csharp", "dotnet restore", "QuickType.cs",
        function (p) {
            execAndCompare(`dotnet run "${p}"`, p, knownFails);
        }
    );
}

function testGolang(samples, knownFails) {
    runTests("Go code", samples, "test/golang", null, "quicktype.go",
        function (p) {
            execAndCompare(`go run main.go quicktype.go < "${p}"`, p, knownFails);
        }
    );
}

function testJsonSchema(samples, knownFails, knownGoFails) {
    runTests("JSON Schema", samples, "test/golang", null, "schema.json",
        function (p) {
            let input = JSON.parse(fs.readFileSync(p));
            let schema = JSON.parse(fs.readFileSync("schema.json"));
            let ajv = new Ajv();
            let valid = ajv.validate(schema, input);
            if (!valid) {
                console.log("Error: Generated schema does not validate input JSON.");
                process.exit(1);
            }
            execQuicktype("schema.json", "quicktype.go", "json-schema");
            execAndCompare(`go run main.go quicktype.go < "${p}"`, p, knownGoFails);
        }
    );
}

function testAll(samples, goFails, csFails, jsonSchemaFails) {
    testJsonSchema(samples, jsonSchemaFails, goFails);
    testGolang(samples, goFails);
    testCSharp(samples, csFails);
}

function testAllInDir(dir, goFails, csFails, jsonSchemaFails) {
    let samples =
        fs.readdirSync(dir)
            .filter((name) => name.endsWith(".json") && !name.startsWith("."))
            .map((name) => absolutize(path.join(dir, name)));
    testAll(samples, goFails, csFails, jsonSchemaFails);
}

function main(sources) {
    if (sources.length == 0) {
        if (!IsCI || !(IsPR || IsBlessed)) {
            console.error("* Testing samples on non-PR non-blessed branch");
            let samples = Samples.samples.map((name) => path.join("..", "..", "app", "public", "sample", "json", name));
            testAll(samples, [], [], []);
        }

        if (!IsCI || (IsBlessed)) {
            console.error("* Running full test suite");
            testAllInDir(path.join("test", "inputs", "json"), ["identifiers.json"], [], []);
        } else {
            console.error("* Skipping full test suite");
        }
    } else {
        sources.forEach((source) => {
            if (fs.lstatSync(source).isDirectory()) {
                testAllInDir(source, [], [], []);
            } else {
                testAll([absolutize(source)], [], [], []);
            }
        });
    }
}

// skip 2 `node` args
main(process.argv.slice(2));
