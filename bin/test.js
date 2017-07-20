#!/usr/bin/env node

const shell = require("shelljs");
const Main = require("../output/Main");
const Samples = require("../output/Samples");

shell.cd("test/csharp");
shell.exec("dotnet restore", { silent: true });

function exec(s, opts, cb) {
    let result = shell.exec(s, opts, cb);
    if (result.code !== 0) {
        shell.exit(result.code);
    }
    return result;
}

Samples.samples.forEach((sample) => {
    console.error(`* Parsing ${sample}`);

    let path = `../../app/public/sample/json/${sample}`;
    exec(`cat ${path} | node ../../bin/quicktype.js > QuickType.cs`);
    exec(`dotnet run ${path}`);
});
