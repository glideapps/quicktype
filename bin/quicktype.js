#!/usr/bin/env node

const fs = require('fs');
const shell = require("shelljs");
const Main = require("../output/Main");
const makeSource = require("stream-json");
const Assembler  = require("stream-json/utils/Assembler");

function renderString(json) {
    let renderer = Main.renderers[0];
    return Main.renderJsonString(renderer)(json).value0;
}

function renderJson(json) {
    let renderer = Main.renderers[0];
    return Main.renderJson(renderer)(json);
}

function work(json) {
  let out = renderString(json);
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
  let source = makeSource();
  let assembler = new Assembler();

  source.output.on("data", function (chunk) {
    assembler[chunk.name] && assembler[chunk.name](chunk.value);
  });
  source.output.on("end", function () {
    shell.echo(renderJson(assembler.current));
  });

  process.stdin.pipe(source.input);

  process.stdin.resume();
  process.stdin.setEncoding('utf8');
} else if (args.length == 1 && args[0] == "--help") {
  usage();
} else if (args.length == 1) {
  parseFileOrUrl(args[0]);
} else {
  usage();
  shell.exit(1);
}
