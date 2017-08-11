#!/usr/bin/env ts-node

import * as fs from "fs";
import * as path from "path";
import * as process from "process";

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
const fetch = require("node-fetch");

const optionDefinitions = [
  {
    name: 'src',
    type: String,
    multiple: true,
    defaultOption: true,
    typeLabel: 'file|url',
    description: 'The JSON file or url to type.'
  },
  {
    name: 'out',
    alias: 'o',
    type: String,
    typeLabel: `file`,
    description: 'The output file.'
  },
  {
    name: 'src-lang',
    alias: 's',
    type: String,
    defaultValue: 'json',
    typeLabel: 'json|schema',
    description: 'The source language.'
  },
  {
    name: 'lang',
    alias: 'l',
    type: String,
    typeLabel: `${Main.renderers.map((r) => r.extension).join("|")}`,
    description: 'The target language.'
  },
  {
    name: 'top-level',
    alias: 't',
    type: String,
    typeLabel: 'name',
    description: 'The name for the top level type.'
  },
  {
    name: 'urls-from',
    type: String,
    typeLabel: '[underline]{file}',
    description: 'Tracery grammar describing URLs to crawl.'
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
  let renderer = Main.renderers.find((r) => {
    return [r.extension, r.aceMode, r.name].indexOf(options.lang) !== -1;
  });

  if (!renderer) {
    console.error(`'${options.lang}' is not yet supported as an output language.`);
    process.exit(1);
  }

  return renderer;
}

function fromRight(either) {
  let { constructor: { name }, value0: result } = either;
  if (name == "Left") {
    console.error(result);
    process.exit(1);
  } else {
    return result;
  }
}

function renderFromJsonArrayMap(jsonArrayMap) {
    let pipeline = {
      "json": Main.renderFromJsonArrayMap,
      "schema": Main.renderFromJsonSchemaArrayMap
    }[options["src-lang"]];
 
    if (!pipeline) {
      console.error(`Input language '${options["src-lang"]}' is not supported.`);
      process.exit(1);
    }

    let input = {
      input: jsonArrayMap,
      renderer: getRenderer()
    };
    
    return fromRight(pipeline(input));    
}

function renderAndOutput(jsonArrayMap) {
  let output = renderFromJsonArrayMap(jsonArrayMap);
  if (options.out) {
    fs.writeFileSync(options.out, output); 
  } else {
    process.stdout.write(output);
  }
}

function workFromJsonArray(jsonArray) {
  let jsonArrayMap = {};
  jsonArrayMap[options["top-level"]] = jsonArray;
  renderAndOutput(jsonArrayMap);
}

function parseJsonFromStream(stream: fs.ReadStream | NodeJS.Socket, continuationWithJson) {
  let source = makeSource();
  let assembler = new Assembler();

  source.output.on("data", chunk => {
    assembler[chunk.name] && assembler[chunk.name](chunk.value);
  });
  source.output.on("end", () => {
    renderAndOutput(assembler.current);
  });

  stream.setEncoding('utf8');
  stream.pipe(source.input);
  stream.resume();
}

function usage() {
  console.log(getUsage(sections));
}

function mapArrayC(array, f, continuation) {
  if (array.length === 0) {
    continuation([]);
    return;
  }

  f(array[0], function(firstResult) {
    mapArrayC(array.slice(1), f, function(restResults) {
      continuation([firstResult].concat(restResults));
    });
  });
}

function mapObjectValuesC(obj, f, continuation) {
  let keys = Object.keys(obj);
  let resultObject = {};
  mapArrayC(keys, function(key, arrayContinuation) {
    let value = obj[key];
    f(value, function(newValue) {
      resultObject[key] = newValue;
      arrayContinuation(null);
    });
  }, function(dummy) {
    continuation(resultObject);
  });
}

function parseFileOrUrl(fileOrUrl: string, continuationWithJson) {
  if (fs.existsSync(fileOrUrl)) {
    parseJsonFromStream(fs.createReadStream(fileOrUrl), continuationWithJson);
  } else {
    fetch(fileOrUrl).then(res => parseJsonFromStream(res.body, continuationWithJson));
  }
}

function parseFileOrUrlArray(filesOrUrls, continuation) {
  mapArrayC(filesOrUrls, parseFileOrUrl, continuation);
}

function inferLang() {
  // Output file extension determines the language if language is undefined
  if (options.out) {
    let extension = path.extname(options.out);
    if (extension == "") {
      console.error("Please specify a language (--lang) or an output file extension.");
      process.exit(1);
    }
    return extension.substr(1);
  }

  return "go";
}

function inferTopLevel(): string {
  // Output file name determines the top-level if undefined
  if (options.out) {
    let extension = path.extname(options.out);
    let without = path.basename(options.out).replace(extension, "");
    return without;
  }

  // Source determines the top-level if undefined
  if (options.src && options.src.length == 1) {
    let src = options.src[0];
    let extension = path.extname(src);
    let without = path.basename(src).replace(extension, "");
    return without;
  }

  return "TopLevel";
}

function main(args: string[]) {
  options["lang"] = options["lang"] || inferLang();
  options["top-level"] = options["top-level"] || inferTopLevel();

  if (options.help) {
    usage();
  } else if (options["urls-from"]) {
    let json = JSON.parse(fs.readFileSync(options["urls-from"], "utf8"));
    let jsonArrayMapOrError = Main.urlsFromJsonGrammar(json);
    let result = jsonArrayMapOrError.value0;
    if (typeof result == 'string') {
      console.error("Error: " + result);
      process.exit(1);
    } else {
      mapObjectValuesC(result, parseFileOrUrlArray, renderAndOutput);
    }
  } else if (!options.src || options.src.length === 0) {
    parseJsonFromStream(process.stdin, function (json) { workFromJsonArray([json]); });
  } else if (options.src.length === 1) {
    parseFileOrUrlArray(options.src, workFromJsonArray);
  } else {
    usage();
    process.exit(1);
  }
}

main(process.argv);
