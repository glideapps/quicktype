import * as fs from "fs";
import * as path from "path";
import * as process from "process";
import * as Either from "./either";
import tryRequire from "./try-require"
import * as _ from "lodash";

const Main: Main = tryRequire("../output/purs/Main", "./Main");
const makeSource = require("stream-json");
const Assembler = require("stream-json/utils/Assembler");
const commandLineArgs = require('command-line-args');
const getUsage = require('command-line-usage');
const fetch = require("node-fetch");
const chalk = require("chalk");

const langs = Main.renderers.map((r) => r.extension).join("|");
const langNames = Main.renderers.map((r) => r.name).join(", ");

const optionDefinitions = [
  {
    name: 'out',
    alias: 'o',
    type: String,
    typeLabel: `FILE`,
    description: 'The output file. Determines --lang and --top-level.'
  },
  {
    name: 'top-level',
    alias: 't',
    type: String,
    typeLabel: 'NAME',
    description: 'The name for the top level type.'
  },
  {
    name: 'lang',
    alias: 'l',
    type: String,
    typeLabel: langs,
    description: 'The target language.'
  },
  {
    name: 'src-lang',
    alias: 's',
    type: String,
    defaultValue: 'json',
    typeLabel: 'json|schema',
    description: 'The source language (default is json).'
  },
  {
    name: 'src',
    type: String,
    multiple: true,
    defaultOption: true,
    typeLabel: 'FILE|URL',
    description: 'The file or url to type.'
  },
  {
    name: 'src-urls',
    type: String,
    typeLabel: 'FILE',
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
    header: 'Synopsis',
    content: `$ quicktype [[bold]{--lang} ${langs}] FILE|URL ...`
  },
  {
    header: 'Description',
    content: `Given JSON sample data, quicktype outputs code for working with that data in ${langNames}.`
  },
  {
    header: 'Options',
    optionList: optionDefinitions
  },
  {
    header: 'Examples',
    content: [
      chalk.dim('Generate C# to parse a Bitcoin API'),
      '$ quicktype -o LatestBlock.cs https://blockchain.info/latestblock',
      '',
      chalk.dim('Generate Go code from a JSON file'),
      '$ quicktype -l go user.json',
      '',
      chalk.dim('Generate JSON Schema, then TypeScript'),
      '$ quicktype -o schema.json https://blockchain.info/latestblock',
      '$ quicktype -o bitcoin.ts --src-lang schema schema.json'
    ]
  },
  {
    content: 'Learn more at [bold]{quicktype.io}'
  }
];

function usage() {
  console.log(getUsage(sections));
}

export interface Options {  
  lang?: string;
  src?: string[];
  topLevel?: string;
  srcLang?: string;
  srcUrls?: string;
  out?: string;
  help?: boolean;
}

interface SampleOrSchemaMap {
  [key: string]: object[];
}

class Run {
  options: Options;

  constructor(argv: string[] | Options) {
    this.options = _.isArray(argv)
      ? this.getOptions(argv)
      : this.inferOptions(argv);
  }

  getRenderer = () => {
    let renderer = Main.renderers.find((r) => _.includes(<{}>r, this.options.lang));

    if (!renderer) {
      console.error(`'${this.options.lang}' is not yet supported as an output language.`);
      process.exit(1);
    }

    return renderer;
  }

  renderSamplesOrSchemas = (samplesOrSchemas: SampleOrSchemaMap): SourceCode => {
    let areSchemas = this.options.srcLang === "schema";

    let config: Config = {
      language: this.getRenderer().extension,
      topLevels: Object.getOwnPropertyNames(samplesOrSchemas).map(name => {
        if (areSchemas) {
          // Only one schema per top-level is used right now
          return { name, schema: samplesOrSchemas[name][0] };
        } else {
          return { name, samples: samplesOrSchemas[name]  };
        }
      })
    };

    return Either.fromRight(Main.main(config));    
  }

  splitAndWriteJava = (dir: string, str: string) => {
    const lines = str.split("\n");
    let filename : string | null = null;
    let currentFileContents : string = "";

    const writeFile = () => {
      if (filename != null) {
        fs.writeFileSync(path.join(dir, filename), currentFileContents);
      }
      filename = null;
      currentFileContents = "";      
    };

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      i += 1;

      const results = line.match("^// (.+\\.java)$");
      if (results == null) {
        currentFileContents += line + "\n";
      } else {
        writeFile();
        filename = results[1];
        while (lines[i] == "")
          i++;
      }
    }
    writeFile();
  }

  renderAndOutput = (samplesOrSchemas: SampleOrSchemaMap) => {
    let output = this.renderSamplesOrSchemas(samplesOrSchemas);
    if (this.options.out) {
      if (this.options.lang == "java") {
        this.splitAndWriteJava(path.dirname(this.options.out), output);
      } else {
        fs.writeFileSync(this.options.out, output);
      }
    } else {
      process.stdout.write(output);
    }
  }

  workFromJsonArray = (jsonArray: object[]) => {
    let map = <SampleOrSchemaMap>{};
    map[this.options.topLevel] = jsonArray;
    this.renderAndOutput(map);
  }

  parseJsonFromStream = (stream: fs.ReadStream | NodeJS.Socket): Promise<object> => {
    return new Promise<object>(resolve => {
      let source = makeSource();
      let assembler = new Assembler();

      let assemble = chunk => assembler[chunk.name] && assembler[chunk.name](chunk.value);
      let isInt = intString => /^\d+$/.test(intString);

      let intSentinelChunks = intString => [
        { name: 'startObject' },
        { name: 'startKey' },
        { name: 'stringChunk', value: Main.intSentinel },
        { name: 'endKey' },
        { name: 'keyValue', value: Main.intSentinel },
        { name: 'startNumber' },
        { name: 'numberChunk', value: intString },
        { name: 'endNumber' },
        { name: 'numberValue', value: intString },
        { name: 'endObject' }        
      ];

      let queue = [];
      source.output.on("data", chunk => {
        switch (chunk.name) {
          case "startNumber":
          case "numberChunk":
          case "endNumber":
            // We queue number chunks until we decide if they are int
            queue.push(chunk);
            break;
          case "numberValue":
            queue.push(chunk);
            if (isInt(chunk.value)) {
              intSentinelChunks(chunk.value).forEach(assemble);
            } else {
              queue.forEach(assemble);
            }
            queue = [];
            break;
          default:
            assemble(chunk);
        }
      });

      source.output.on("end", () => resolve(assembler.current));

      stream.setEncoding('utf8');
      stream.pipe(source.input);
      stream.resume();
    });
  }

  mapValues = async (obj: object, f: (val: any) => Promise<any>): Promise<any> => {
    let result = {};
    for (let key of Object.keys(obj)) {
      result[key] = await f(obj[key]);
    }
    return result;
  }

  parseFileOrUrl = async (fileOrUrl: string): Promise<object> => {
    if (fs.existsSync(fileOrUrl)) {
      return this.parseJsonFromStream(fs.createReadStream(fileOrUrl));
    } else {
      let res = await fetch(fileOrUrl);
      return this.parseJsonFromStream(res.body);
    }
  }

  parseFileOrUrlArray = (filesOrUrls: string[]): Promise<object[]> => {
    return Promise.all(filesOrUrls.map(this.parseFileOrUrl));
  }

  main = async () => {
    if (this.options.help) {
      usage();
    } else if (this.options.srcUrls) {
      let json = JSON.parse(fs.readFileSync(this.options.srcUrls, "utf8"));
      let jsonMap = Either.fromRight(Main.urlsFromJsonGrammar(json));
      this.renderAndOutput(await this.mapValues(jsonMap, this.parseFileOrUrlArray));
    } else if (this.options.src.length == 0) {
      let json = await this.parseJsonFromStream(process.stdin);
      this.workFromJsonArray([json]);
    } else if (this.options.src.length == 1) {
      let jsons = await this.parseFileOrUrlArray(this.options.src);
      this.workFromJsonArray(jsons);
    } else {
      usage();
      process.exit(1);
    }
  }

  getOptions = (argv: string[]): Options => {
    let opts: { [key: string]: any } = commandLineArgs(optionDefinitions, { argv });
    let sane = _.mapKeys(opts, (v, k) => {
      // Turn options like 'src-urls' into 'srcUrls'
      return _.lowerFirst(k.split('-').map(_.upperFirst).join(''));
    });
    return this.inferOptions(sane);
  }

  inferOptions = (opts: Options): Options => {
    opts.src = opts.src || [];
    opts.srcLang = opts.srcLang || "json";
    opts.lang = opts.lang || this.inferLang(opts);
    opts.topLevel = opts.topLevel || this.inferTopLevel(opts);
    return opts;
  }

  inferLang = (options: Options): string => {
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

  inferTopLevel = (options: Options): string => {
    // Output file name determines the top-level if undefined
    if (options.out) {
      let extension = path.extname(options.out);
      let without = path.basename(options.out).replace(extension, "");
      return without;
    }

    // Source determines the top-level if undefined
    if (options.src.length == 1) {
      let src = options.src[0];
      let extension = path.extname(src);
      let without = path.basename(src).replace(extension, "");
      return without;
    }

    return "TopLevel";
  }
}

export async function main(args: string[] | Options) {
  if (_.isArray(args) && args.length == 0) {
    usage();
  } else {
    let run = new Run(args);
    await run.main();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(reason => {
    console.error(reason);
    process.exit(1);
  });
}