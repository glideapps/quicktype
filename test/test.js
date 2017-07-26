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
        exec(`node ../../cli/quicktype.js -o QuickType.cs "${p}"`);
        exec(`dotnet run "${p}"`);
    });

    shell.cd("../..");
}

function testGolang(samples) {
    shell.cd("test/golang");

    samples.forEach((sample) => {
        console.error(`* Building Go code for ${sample}`);

        var p = sample;
        if (!path.isAbsolute(p))
            p = path.join("..", "..", "app", "public", "sample", "json", p);
        exec(`node ../../cli/quicktype.js -o quicktype.go "${p}"`);
        exec(`go run main.go quicktype.go < "${p}"`, {silent:true});
    });

    shell.cd("../..");
}

function testAll(samples) {
    testGolang(samples);
    testCSharp(samples);
}

function main(sources) {
    if (sources.length == 0) {
        testAll(Samples.samples)
    } else {
        sources.forEach((source) => {
            if (fs.lstatSync(source).isDirectory()) {
                let samples =
                    fs.readdirSync(source)
                        .filter((name) => name.endsWith(".json") && !name.startsWith("."))
                        .map((name) => absolutize(path.join(source, name)));
                testAll(samples);
            } else {
                testAll([absolutize(arg)]);
            }
        });
    }
}

// skip 2 `node` args
main(process.argv.slice(2));
