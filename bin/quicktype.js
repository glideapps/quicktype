#!/usr/bin/env node

var shell = require("shelljs");
const Main = require("../output/Main");

function render(json) {
    let renderer = Main.renderers[0];
    return Main.renderJson(renderer)(json).value0;
}

let args = process.argv.slice(2);
let url = args[0];

shell.exec(`curl -s ${url} 2> /dev/null`, { silent: true }, (code, json, stderr) => {
  let out = render(json);
  shell.echo(out);
});
