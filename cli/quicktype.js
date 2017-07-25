#!/usr/bin/env node

const fs = require('fs');
const shell = require("shelljs");
const Main = require("./bundle");
const makeSource = require("stream-json");
const Assembler  = require("stream-json/utils/Assembler");
const commandLineArgs = require('command-line-args')
const getUsage = require('command-line-usage')

const optionDefinitions = [
  {
    name: 'src',
    type: String,
    multiple: true,
    defaultOption: true,
    typeLabel: '[underline]{file|url}',
    description: 'The JSON file or url to type.'
  },
  {
    name: 'output',
    alias: 'o',
    type: String,
    typeLabel: `[underline]{output}`,
    description: 'The desired output file name.'
  },
  {
    name: 'lang',
    alias: 'l',
    type: String,
    typeLabel: `[underline]{${Main.renderers.map((r) => r.extension).join("|")}}`,
    description: 'The target language.'
  },
  {
    name: 'help',
    alias: 'h',
    type: Boolean,
    description: 'Get some help.'
  }
];

const sections = [
  {
    header: 'quicktype',
    content: 'Quickly generate types from data'
  },
  {
    header: 'Options',
    optionList: optionDefinitions
  },
  {
    header: 'Examples',
    content: [
      '$ quicktype [bold]{-o} LatestBlock.cs [underline]{https://blockchain.info/latestblock}'
    ]
  }
];

const options = commandLineArgs(optionDefinitions);

function getRenderer() {
  let lang = options.lang || "cs";
  return Main.renderers.find((r) => r.extension === lang);
}

function renderString(json) {
    let renderer = getRenderer();
    return Main.renderJsonString(renderer)(json).value0;
}

function renderJson(json) {
    let renderer = getRenderer();
    return Main.renderJson(renderer)(json);
}

function work(json) {
  let out = renderString(json);
  if (options.output) {
    fs.writeFile(options.output, out, (err) => {
        if (err) {
            console.error(err);
            shell.exit(1);
        }
    }); 
  } else {
    console.log(out);
  }
}

function usage() {
  console.log(getUsage(sections));
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

// Output file extension determines the language if language is undefined
if (options.output && !options.lang) {
  if (options.output.indexOf(".") < 0) {
    console.error("Please specify a language (--lang) or an output file extension.");
    shell.exit(1);
  }
  options.lang = options.output.split(".").pop();
}

if (options.help) {
  usage();
} else if (!options.src || options.src.length === 0) {
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
} else if (options.src.length == 1) {
  parseFileOrUrl(options.src[0]);
} else {
  usage();
  shell.exit(1);
}
