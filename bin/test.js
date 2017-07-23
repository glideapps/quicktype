#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const shell = require("shelljs");
const Main = require("../output/Main");
const Samples = require("../output/Samples");

function exec(s, opts, cb) {
    let result = shell.exec(s, opts, cb);
    if (result.code !== 0) {
        shell.exit(result.code);
    }
    return result;
}

function absolutize(p) {
    if (path.isAbsolute(p))
        return p;
    return path.join(process.cwd(), p);
}

function testCSharp(samples) {
    shell.cd("test/csharp");
    shell.exec("dotnet restore", { silent: true });

    samples.forEach((sample) => {
        console.error(`* Building C# code for ${sample}`);

        var p = sample;
        if (!path.isAbsolute(p))
            p = path.join("..", "..", "app", "public", "sample", "json", p);
        exec(`node ../../bin/quicktype.js "${p}" > QuickType.cs`);
        exec(`dotnet run "${p}"`);
    });

    shell.cd("../..");
}

if (process.argv.length > 3) {
    console.log("Usage: " + __filename + " [TEST-DIR]");
    process.exit(1);
}

if (process.argv.length == 2) {
    testCSharp(Samples.samples);
} else {
    let dir = process.argv[2];
    fs.readdir(dir, function(err, items) {
        if (err) {
            console.log("Error: Could not read directory " + dir);
            process.exit(1);
        }
        let samples = [];
        for (var i=0; i<items.length; i++) {
            let name = items[i];
            if (name.startsWith(".") || !name.endsWith(".json"))
                continue;
            var joined = path.join(dir, name);
            if (!path.isAbsolute(joined))
                joined = path.join(process.cwd(), joined);
            samples.push(joined);
        }
        testCSharp(samples);
    });
}
