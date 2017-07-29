#!/usr/bin/env node

const fs = require('fs');
const shell = require("shelljs");

const Main = (() => {
  try {
    return require("../output/Main");
  } catch (e) {
    return require("./bundle");    
  }
})();

const makeSource = require("stream-json");
const Assembler  = require("stream-json/utils/Assembler");
const commandLineArgs = require('command-line-args')
const getUsage = require('command-line-usage')
const fetch = require('node-fetch');

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
    description: 'The output file.'
  },
  {
    name: 'srcLang',
    type: String,
    defaultValue: 'json',
    typeLabel: '[underline]{json|json-schema}',
    description: 'The source language.'
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
  let renderer = Main.renderers.find((r) => r.extension === lang);

  if (!renderer) {
    console.error(`'${lang}' is not yet supported as an output language.`);
    process.exit(1);
  }

  return renderer;
}

function fromRight(either) {
  let { constructor: { name }, value0: result } = either;
  if (name == "Left") {
    console.error(result);
    console.exit(1);
  } else {
    return result;
  }
}

function renderFromJson(json) {
    let pipeline = {
      "json": Main.renderFromJson,
      "json-schema": Main.renderFromJsonSchema
    }[options.srcLang];
 
    if (!pipeline) {
      console.error(`Input language '${options.srcLang}' is not supported.`);
      process.exit(1);
    }

    let renderer = getRenderer();
    return fromRight(pipeline(renderer)(json));    
}

function work(json) {
  let output = renderFromJson(json);
  if (options.output) {
    fs.writeFileSync(options.output, output); 
  } else {
    console.log(output);
  }
}

function workFromStream(stream) {
  let source = makeSource();
  let assembler = new Assembler();

  source.output.on("data", function (chunk) {
    assembler[chunk.name] && assembler[chunk.name](chunk.value);
  });
  source.output.on("end", function () {
    work(assembler.current);
  });

  stream.setEncoding('utf8');
  stream.pipe(source.input);
  stream.resume();
}

function usage() {
  console.log(getUsage(sections));
}

function parseFileOrUrl(fileOrUrl) {
  if (fs.existsSync(fileOrUrl)) {
    workFromStream(fs.createReadStream(fileOrUrl));
  } else {
    fetch(fileOrUrl).then(res => workFromStream(res.body));
  }
}

// Output file extension determines the language if language is undefined
if (options.output && !options.lang) {
  if (options.output.indexOf(".") < 0) {
    console.error("Please specify a language (--lang) or an output file extension.");
    process.exit(1);
  }
  options.lang = options.output.split(".").pop();
}

if (options.help) {
  usage();
} else if (!options.src || options.src.length === 0) {
  workFromStream(process.stdin);
} else if (options.src.length == 1) {
  parseFileOrUrl(options.src[0]);
} else {
  usage();
  process.exit(1);
}
