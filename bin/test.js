#!/usr/bin/env node

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

function testCSharp() {
    shell.cd("test/csharp");
    shell.exec("dotnet restore", { silent: true });

    Samples.samples.forEach((sample) => {
        console.error(`* Building C# code for ${sample}`);

        let path = `../../app/public/sample/json/${sample}`;
        exec(`node ../../bin/quicktype.js ${path} > QuickType.cs`);
        exec(`dotnet run ${path}`);
    });

    shell.cd("../..");
}

testCSharp();
