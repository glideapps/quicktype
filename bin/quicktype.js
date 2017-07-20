#!/usr/bin/env node

var shell = require("shelljs");
const Main = require("../output/Main");

function render(json) {
    let renderer = Main.renderers[0];
    return Main.renderJson(renderer)(json).value0;
}

function work(json) {
  let out = render(json);
  shell.echo(out);
}

function usage() {
  shell.echo("Usage:");
  shell.echo("    quicktype          reads JSON from stdin");
  shell.echo("    quicktype URL      fetches JSON from URL");
}

let args = process.argv.slice(2);

if (args.length == 0) {
  // https://gist.github.com/kristopherjohnson/5065599
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  let chunks = [];
  process.stdin.on('data', function (chunk) {
    chunks.push(chunk);
  });

  process.stdin.on('end', function () {
    work(chunks.join(""));
  });
} else if (args.length == 1 && args[0] == "--help") {
  usage();
} else if (args.length == 1) {
  let url = args[0];

  shell.exec(`curl -s ${url} 2> /dev/null`, { silent: true }, (code, json, stderr) => {
    work(json);
  });
} else {
  usage();
  shell.exit(1);
}
