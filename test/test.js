#!/usr/bin/env node

const Ajv = require('ajv');
const fs = require("fs");
const path = require("path");
const shell = require("shelljs");
const Main = require("../output/Main");
const Samples = require("../output/Samples");

// https://stackoverflow.com/questions/1068834/object-comparison-in-javascript
function deepEquals(x, y) {
    var i;
    var p;

    // remember that NaN === NaN returns false
    // and isNaN(undefined) returns true
    if (isNaN(x) && isNaN(y) && typeof x === 'number' && typeof y === 'number') {
        return true;
    }

    // Compare primitives and functions.     
    // Check if both arguments link to the same object.
    // Especially useful on the step where we compare prototypes
    if (x === y) {
        return true;
    }

    if ((x instanceof String && y instanceof String) || (x instanceof Number && y instanceof Number)) {
        if (x.toString() !== y.toString()) {
            console.log("Number or string not equal.");
            return false;
        }
        return true;
    }

    // At last checking prototypes as good as we can
    if (!(x instanceof Object && y instanceof Object)) {
        console.log("One is not an object.")
        return false;
    }

    if (x.constructor !== y.constructor) {
        console.log("Not the same constructor.");
        return false;
    }

    if (x.prototype !== y.prototype) {
        console.log("Not the same prototype.");
        return false;
    }

    if (Array.isArray(x)) {
        if (x.length !== y.length){
            console.log("Arrays don't have the same length.");
            return false;
        }
        for (i = 0; i < x.length; i++) {
            if (!deepEquals(x[i], y[i]))
                return false;
        }
        return true;
    }

    for (p in y) {
        // We allow properties in y that aren't present in x
        // so long as they're null.
        if (y.hasOwnProperty(p) && !x.hasOwnProperty(p)) {
            if (y[p] !== null) {
                console.log(`Non-null property ${p} is not expected.`);
                return false;
            }
            continue;
        }
        if (typeof y[p] !== typeof x[p]) {
            console.log(`Properties ${p} don't have the same types.`);
            return false;
        }
    }
    
    for (p in x) {
        if (x.hasOwnProperty(p) && !y.hasOwnProperty(p)) {
            console.log(`Expected property ${p} not found.`);
            return false;
        }
        if (typeof x[p] !== typeof y[p]) {
            console.log(`Properties ${p} don't have the same types.`);
            return false;
        }

        switch (typeof(x[p])) {
        case 'object':
            if (!deepEquals(x[p], y[p])) {
                return false;
            }
            break;
            
        default:
            if (x[p] !== y[p]) {
                console.log(`Non-object properties ${p} are not equal.`)
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
        shell.exit(result.code);
    }
    return result;
}

function execAndCompare(cmd, sample, p, knownFails) {
    let outputString = exec(cmd, {silent:true}).stdout;
    if (knownFails.indexOf(sample) < 0) {
        let outputJSON = JSON.parse(outputString);
        let inputJSON = JSON.parse(fs.readFileSync(p));
        if (!deepEquals(inputJSON, outputJSON)) {
            console.log("Error: Output is not equivalent to input.");
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

function testCSharp(samples, knownFails) {
    shell.cd("test/csharp");
    shell.exec("dotnet restore", { silent: true });
    
    samples.forEach((sample) => {
        console.error(`* Building C# code for ${sample}`);
        
        var p = sample;
        if (!path.isAbsolute(p))
            p = path.join("..", "..", "app", "public", "sample", "json", p);
        exec(`node ../../cli/quicktype.js -o QuickType.cs "${p}"`);
        execAndCompare(`dotnet run "${p}"`, sample, p, knownFails);
    });
    
    shell.cd("../..");
}

function testGolang(samples, knownFails) {
    shell.cd("test/golang");
    
    samples.forEach((sample) => {
        console.error(`* Building Go code for ${sample}`);
        
        var p = sample;
        if (!path.isAbsolute(p))
            p = path.join("..", "..", "app", "public", "sample", "json", p);
        exec(`node ../../cli/quicktype.js -o quicktype.go "${p}"`);
        execAndCompare(`go run main.go quicktype.go < "${p}"`, sample, p, knownFails);
    });
    
    shell.cd("../..");
}

function testJsonSchema(samples, knownFails) {
    shell.cd("test/golang");
    
    samples.forEach((sample) => {
        console.error(`* Building JSON Schema for ${sample}`);
        
        var p = sample;
        if (!path.isAbsolute(p))
            p = path.join("..", "..", "app", "public", "sample", "json", p);
        exec(`node ../../cli/quicktype.js -o schema.json "${p}"`);

        let input = JSON.parse(fs.readFileSync(p));
        let schema = JSON.parse(fs.readFileSync("schema.json"));
        let ajv = new Ajv();
        let valid = ajv.validate(schema, input);
        if (!valid) {
            console.log("Error: Generated schema does not validate input JSON.");
            process.exit(1);
        }
    });
    
    shell.cd("../..");
}

function testAll(samples, goFails, csFails, jsonSchemaFails) {
    testJsonSchema(samples, jsonSchemaFails);
    testGolang(samples, goFails);
    testCSharp(samples, csFails);
}

function main(sources) {
    if (sources.length == 0) {
        testAll(Samples.samples, ["identifiers.json"], [], []);
    } else {
        sources.forEach((source) => {
            if (fs.lstatSync(source).isDirectory()) {
                let samples =
                    fs.readdirSync(source)
                        .filter((name) => name.endsWith(".json") && !name.startsWith("."))
                        .map((name) => absolutize(path.join(source, name)));
                testAll(samples, [], []);
            } else {
                testAll([absolutize(arg)], [], []);
            }
        });
    }
}

// skip 2 `node` args
main(process.argv.slice(2));
