import * as fs from "fs";
import * as path from "path";

import * as _ from "lodash";
import { Run, Options, RendererOptions, inferOptions, getTargetLanguage } from ".";
import { OptionDefinition } from "./RendererOptions";
import * as targetLanguages from "./Language/All";
import { Annotation } from "./Source";
import { IssueAnnotationData } from "./Annotation";

const commandLineArgs = require("command-line-args");
const getUsage = require("command-line-usage");

const fetch = require("node-fetch");
const chalk = require("chalk");

const langs = targetLanguages.all.map(r => _.minBy(r.names, s => s.length)).join("|");
const langDisplayNames = targetLanguages.all.map(r => r.displayName).join(", ");

export interface CLIOptions extends Options {
    help: boolean;
    quiet: boolean;
}

const optionDefinitions: OptionDefinition[] = [
    {
        name: "out",
        alias: "o",
        type: String,
        typeLabel: `FILE`,
        description: "The output file. Determines --lang and --top-level."
    },
    {
        name: "top-level",
        alias: "t",
        type: String,
        typeLabel: "NAME",
        description: "The name for the top level type."
    },
    {
        name: "lang",
        alias: "l",
        type: String,
        typeLabel: langs,
        description: "The target language."
    },
    {
        name: "src-lang",
        alias: "s",
        type: String,
        defaultValue: "json",
        typeLabel: "json|schema",
        description: "The source language (default is json)."
    },
    {
        name: "src",
        type: String,
        multiple: true,
        defaultOption: true,
        typeLabel: "FILE|URL|DIRECTORY",
        description: "The file, url, or data directory to type."
    },
    {
        name: "src-urls",
        type: String,
        typeLabel: "FILE",
        description: "Tracery grammar describing URLs to crawl."
    },
    {
        name: "no-combine-classes",
        type: Boolean,
        description: "Don't combine similar classes."
    },
    {
        name: "no-maps",
        type: Boolean,
        description: "Don't infer maps, always use classes."
    },
    {
        name: "no-enums",
        type: Boolean,
        description: "Don't infer enums, always use strings."
    },
    {
        name: "no-render",
        type: Boolean,
        description: "Don't render output."
    },
    {
        name: "quiet",
        type: Boolean,
        description: "Don't show issues in the generated code."
    },
    {
        name: "help",
        alias: "h",
        type: Boolean,
        description: "Get some help."
    }
];

interface UsageSection {
    header?: string;
    content?: string | string[];
    optionList?: OptionDefinition[];
    hide?: string[];
}

const sectionsBeforeRenderers: UsageSection[] = [
    {
        header: "Synopsis",
        content: `$ quicktype [[bold]{--lang} ${langs}] FILE|URL ...`
    },
    {
        header: "Description",
        content: `Given JSON sample data, quicktype outputs code for working with that data in ${langDisplayNames}.`
    },
    {
        header: "Options",
        optionList: optionDefinitions,
        hide: ["no-render"]
    }
];

const sectionsAfterRenderers: UsageSection[] = [
    {
        header: "Examples",
        content: [
            chalk.dim("Generate C# to parse a Bitcoin API"),
            "$ quicktype -o LatestBlock.cs https://blockchain.info/latestblock",
            "",
            chalk.dim("Generate Go code from a directory of samples containing:"),
            chalk.dim(
                `  - Foo.json
  + Bar
    - bar-sample-1.json
    - bar-sample-2.json
  - Baz.url`
            ),
            "$ quicktype -l go samples",
            "",
            chalk.dim("Generate JSON Schema, then TypeScript"),
            "$ quicktype -o schema.json https://blockchain.info/latestblock",
            "$ quicktype -o bitcoin.ts --src-lang schema schema.json"
        ]
    },
    {
        content: "Learn more at [bold]{quicktype.io}"
    }
];

function getOptionDefinitions(opts: Options): OptionDefinition[] {
    return getTargetLanguage(opts.lang).optionDefinitions;
}

function parseArgv(argv: string[]): Options {
    // We can only fully parse the options once we know which renderer is selected,
    // because there are renderer-specific options.  But we only know which renderer
    // is selected after we've parsed the options.  Hence, we parse the options
    // twice.  This is the first parse to get the renderer:
    const incompleteOptions = parseOptions(optionDefinitions, argv, true);
    const rendererOptionDefinitions = getOptionDefinitions(incompleteOptions);
    // Use the global options as well as the renderer options from now on:
    const allOptionDefinitions = _.concat(optionDefinitions, rendererOptionDefinitions);
    try {
        // This is the parse that counts:
        return parseOptions(allOptionDefinitions, argv, false);
    } catch (error) {
        if (error.name === "UNKNOWN_OPTION") {
            usage();
            throw new Error("Unknown option");
        }
        throw error;
    }
}

// Parse the options in argv and split them into global options and renderer options,
// according to each option definition's `renderer` field.  If `partial` is false this
// will throw if it encounters an unknown option.
function parseOptions(definitions: OptionDefinition[], argv: string[], partial: boolean): Options {
    const opts: { [key: string]: any } = commandLineArgs(definitions, {
        argv,
        partial: partial
    });
    const options: { rendererOptions: RendererOptions; [key: string]: any } = { rendererOptions: {} };
    definitions.forEach(o => {
        if (!(o.name in opts)) return;
        const v = opts[o.name];
        if (o.renderer) options.rendererOptions[o.name] = v;
        else {
            const k = _.lowerFirst(
                o.name
                    .split("-")
                    .map(_.upperFirst)
                    .join("")
            );
            options[k] = v;
        }
    });
    return inferOptions(options);
}

function usage() {
    const rendererSections: UsageSection[] = [];

    _.forEach(targetLanguages.all, language => {
        const definitions = language.optionDefinitions;
        if (definitions.length === 0) return;

        rendererSections.push({
            header: `Options for ${language.displayName}`,
            optionList: definitions
        });
    });

    const sections = _.concat(sectionsBeforeRenderers, rendererSections, sectionsAfterRenderers);

    console.log(getUsage(sections));
}

function splitAndWriteJava(dir: string, str: string) {
    const lines = str.split("\n");
    let filename: string | null = null;
    let currentFileContents: string = "";

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
            while (lines[i] === "") i++;
        }
    }
    writeFile();
}

export async function main(args: string[] | Partial<CLIOptions>) {
    if (_.isArray(args) && args.length === 0) {
        usage();
    } else {
        let options = _.isArray(args) ? parseArgv(args) : args;
        let run = new Run(options, false);

        if (options.help) {
            usage();
            return;
        }

        const { lines, annotations } = await run.run();
        const output = lines.join("\n");
        if (options.out) {
            if (options.lang === "java") {
                splitAndWriteJava(path.dirname(options.out), output);
            } else {
                fs.writeFileSync(options.out, output);
            }
        } else {
            process.stdout.write(output);
        }
        if (options.quiet) {
            return;
        }
        annotations.forEach((sa: Annotation) => {
            const annotation = sa.annotation;
            if (!(annotation instanceof IssueAnnotationData)) return;
            const lineNumber = sa.span.start.line;
            const humanLineNumber = lineNumber + 1;
            console.error(`\nIssue in line ${humanLineNumber}: ${annotation.message}`);
            console.error(`${humanLineNumber}: ${lines[lineNumber]}`);
        });
    }
}

if (require.main === module) {
    main(process.argv.slice(2)).catch(e => {
        if (e instanceof Error) {
            console.error(`Error: ${e.message}.`);
        } else {
            console.error(e);
        }
        process.exit(1);
    });
}
