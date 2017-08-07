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
    description: 'The JSON files or URLs to type.'
  },
  {
    name: 'urls-from',
    type: String,
    typeLabel: '[underline]{file}',
    description: 'Tracery grammar describing URLs to crawl.'
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
    name: 'topLevel',
    type: String,
    defaultValue: 'TopLevel',
    typeLabel: '[underline]{type name}',
    description: 'The name for the top level type.'
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

function renderFromJsonArrayMap(jsonArrayMap) {
    let pipeline = {
      "json": Main.renderFromJsonArrayMap,
      "json-schema": Main.renderFromJsonSchemaArrayMap
    }[options.srcLang];
 
    if (!pipeline) {
      console.error(`Input language '${options.srcLang}' is not supported.`);
      process.exit(1);
    }

    let input = {
      input: jsonArrayMap,
      renderer: getRenderer()
    };
    
    return fromRight(pipeline(input));    
}

function work(jsonArrayMap) {
  let output = renderFromJsonArrayMap(jsonArrayMap);
  if (options.output) {
    fs.writeFileSync(options.output, output); 
  } else {
    process.stdout.write(output);
  }
}

function workFromJsonArray(jsonArray) {
  let jsonArrayMap = {};
  jsonArrayMap[options.topLevel] = jsonArray;
  work(jsonArrayMap);
}

function parseJsonFromStream(stream, continuationWithJson) {
  let source = makeSource();
  let assembler = new Assembler();

  source.output.on("data", function (chunk) {
    assembler[chunk.name] && assembler[chunk.name](chunk.value);
  });
  source.output.on("end", function () {
    continuationWithJson(assembler.current);
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

function parseFileOrUrl(fileOrUrl, continuationWithJson) {
  if (fs.existsSync(fileOrUrl)) {
    parseJsonFromStream(fs.createReadStream(fileOrUrl), continuationWithJson);
  } else {
    fetch(fileOrUrl).then(res => parseJsonFromStream(res.body, continuationWithJson));
  }
}

function parseFileOrUrlArray(filesOrUrls, continuation) {
  mapArrayC(filesOrUrls, parseFileOrUrl, continuation);
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
} else if (options["urls-from"]) {
  let json = JSON.parse(fs.readFileSync(options["urls-from"]));
  let jsonArrayMapOrError = Main.urlsFromJsonGrammar(json);
  let result = jsonArrayMapOrError.value0;
  if (typeof result == 'string') {
    console.error("Error: " + result);
    process.exit(1);
  } else {
    mapObjectValuesC(result, parseFileOrUrlArray, work);
  }
} else if (!options.src || options.src.length === 0) {
  let jsonArrayMap = [];
  jsonArrayMap[options.topLevel] = [json];
  parseJsonFromStream(process.stdin, function (json) { workFromJsonArray([json]); });
} else if (options.src) {
  parseFileOrUrlArray(options.src, workFromJsonArray);
} else {
  usage();
  process.exit(1);
}
