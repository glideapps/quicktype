#!/usr/bin/env node

const shell = require("shelljs");
const Main = require("./output/Main");
const Samples = require("./output/Samples");


function exec(s, opts, cb) {
    let result = shell.exec(s, opts, cb);
    if (result.code !== 0) {
        shell.exit(result.code);
    }
    return result;
}

shell.cd("test/csharp");
shell.exec("dotnet restore", { silent: true });

Samples.samples.forEach((sample) => {
    console.error(`* Parsing ${sample}`);

    shell.exec("pwd");
    shell.exec("ls ../../");
    shell.exec("ls ../../app");
    shell.exec("ls -R ../../app/public");

    let path = `../../app/public/sample/json/${sample}`;
    exec(`cat ${path} | node ../../bin/quicktype.js > QuickType.cs`);
    exec(`dotnet run ${path}`);
});
