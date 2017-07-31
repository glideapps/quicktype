#!/usr/bin/env node

const Ajv = require('ajv');
const fs = require("fs");
const path = require("path");
const shell = require("shelljs");
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

// https://stackoverflow.com/questions/1068834/object-comparison-in-javascript
function deepEquals(x, y, path) {
    var i;
    var p;

    // remember that NaN === NaN returns false
    // and isNaN(undefined) returns true
    if (typeof x === 'number' && typeof y === 'number') {
        if (isNaN(x) && isNaN(y))
            return true;
        // because sometimes Newtonsoft.JSON is not exact
        return Math.fround(x) === Math.fround(y);
    }

    // Compare primitives and functions.     
    // Check if both arguments link to the same object.
    // Especially useful on the step where we compare prototypes
    if (x === y) {
        return true;
    }

    if ((x instanceof String && y instanceof String) || (x instanceof Number && y instanceof Number)) {
        if (x.toString() !== y.toString()) {
            console.error(`Number or string not equal at path ${pathToString(path)}.`);
            return false;
        }
        return true;
    }

    // At last checking prototypes as good as we can
    if (!(x instanceof Object && y instanceof Object)) {
        console.error(`One is not an object at path ${pathToString(path)}.`)
        return false;
    }

    if (x.constructor !== y.constructor) {
        console.error(`Not the same constructor at path ${pathToString(path)}.`);
        return false;
    }

    if (x.prototype !== y.prototype) {
        console.error(`Not the same prototype at path ${pathToString(path)}.`);
        return false;
    }

    if (Array.isArray(x)) {
        if (x.length !== y.length){
            console.error(`Arrays don't have the same length at path ${pathToString(path)}.`);
            return false;
        }
        for (i = 0; i < x.length; i++) {
            path.push(i)
            if (!deepEquals(x[i], y[i], path))
                return false;
            path.pop();
        }
        return true;
    }

    for (p in y) {
        // We allow properties in y that aren't present in x
        // so long as they're null.
        if (y.hasOwnProperty(p) && !x.hasOwnProperty(p)) {
            if (y[p] !== null) {
                console.error(`Non-null property ${p} is not expected at path ${pathToString(path)}.`);
                return false;
            }
            continue;
        }
        if (typeof y[p] !== typeof x[p]) {
            console.error(`Properties ${p} don't have the same types at path ${pathToString(path)}.`);
            return false;
        }
    }
    
    for (p in x) {
        if (x.hasOwnProperty(p) && !y.hasOwnProperty(p)) {
            console.error(`Expected property ${p} not found at path ${pathToString(path)}.`);
            return false;
        }
        if (typeof x[p] !== typeof y[p]) {
            console.error(`Properties ${p} don't have the same types at path ${pathToString(path)}.`);
            return false;
        }

        switch (typeof(x[p])) {
        case 'object':
            path.push(p);
            if (!deepEquals(x[p], y[p], path)) {
                return false;
            }
            path.pop(p);
            break;
            
        default:
            if (x[p] !== y[p]) {
                console.error(`Non-object properties ${p} are not equal at path ${pathToString(path)}.`)
                return false;
            }
            break;
        }
    }
    
    return true;
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
