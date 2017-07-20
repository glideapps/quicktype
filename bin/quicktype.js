#!/usr/bin/env node

var shell = require("shelljs");
const fs = require('fs');
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
  shell.echo("    quicktype FILE     reads JSON from FILE");
  shell.echo("    quicktype URL      fetches JSON from URL");
}

function parseFile(file) {
  fs.readFile(file, 'utf8', (err, json) => {
    work(json);
  });
}

function parseUrl(url) {
  shell.exec(`curl -s ${url} 2> /dev/null`, { silent: true }, (code, json, stderr) => {
    work(json);
  });
}

function parseFileOrUrl(fileOrUrl) {
  if (fs.existsSync(fileOrUrl)) {
    parseFile(fileOrUrl);
  } else {
    parseUrl(fileOrUrl);
  }
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
  parseFileOrUrl(args[0]);
} else {
  usage();
  shell.exit(1);
}
