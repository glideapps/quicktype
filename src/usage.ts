#!/usr/bin/env node

import chalk from "chalk";
import getUsage from "command-line-usage";
import * as _ from "lodash";
import _wordwrap from "wordwrap";

import type { OptionDefinition, TargetLanguage } from "quicktype-core";

import { makeOptionDefinitions } from "./optionDefinitions";
import { makeLangTypeLabel } from "./utils";

interface ColumnDefinition {
    name: string;
    padding?: { left: string; right: string };
    width?: number;
}

interface TableOptions {
    columns: ColumnDefinition[];
}

interface UsageSection {
    content?: string | string[];
    header?: string;
    hide?: string[];
    optionList?: OptionDefinition[];
    tableOptions?: TableOptions;
}

const tableOptionsForOptions: TableOptions = {
    columns: [
        {
            name: "option",
            width: 60,
        },
        {
            name: "description",
            width: 60,
        },
    ],
};

function makeSectionsBeforeRenderers(
    targetLanguages: readonly TargetLanguage[],
): UsageSection[] {
    const langDisplayNames = targetLanguages
        .map((r) => r.displayName)
        .join(", ");

    return [
        {
            header: "Synopsis",
            content: [
                `$ quicktype [${chalk.bold("--lang")} LANG] [${chalk.bold("--src-lang")} SRC_LANG] [${chalk.bold(
                    "--out",
                )} FILE] FILE|URL ...`,
                "",
                `  LANG ... ${makeLangTypeLabel(targetLanguages)}`,
                "",
                "SRC_LANG ... json|schema|graphql|postman|typescript",
            ],
        },
        {
            header: "Description",
            content: `Given JSON sample data, quicktype outputs code for working with that data in ${langDisplayNames}.`,
        },
        {
            header: "Options",
            optionList: makeOptionDefinitions(targetLanguages),
            hide: ["no-render", "build-markov-chain"],
            tableOptions: tableOptionsForOptions,
        },
    ];
}

const sectionsAfterRenderers: UsageSection[] = [
    {
        header: "Examples",
        content: [
            chalk.dim("Generate C# to parse a Bitcoin API"),
            "$ quicktype -o LatestBlock.cs https://blockchain.info/latestblock",
            "",
            chalk.dim(
                "Generate Go code from a directory of samples containing:",
            ),
            chalk.dim(
                `  - Foo.json
  + Bar
    - bar-sample-1.json
    - bar-sample-2.json
  - Baz.url`,
            ),
            "$ quicktype -l go samples",
            "",
            chalk.dim("Generate JSON Schema, then TypeScript"),
            "$ quicktype -o schema.json https://blockchain.info/latestblock",
            "$ quicktype -o bitcoin.ts --src-lang schema schema.json",
        ],
    },
    {
        content: `Learn more at ${chalk.bold("quicktype.io")}`,
    },
];

export function usage(targetLanguages: readonly TargetLanguage[]): void {
    const rendererSections: UsageSection[] = [];

    for (const language of targetLanguages) {
        const definitions = language.cliOptionDefinitions.display;
        if (definitions.length === 0) continue;

        rendererSections.push({
            header: `Options for ${language.displayName}`,
            optionList: definitions,
            tableOptions: tableOptionsForOptions,
        });
    }

    const sections = _.concat(
        makeSectionsBeforeRenderers(targetLanguages),
        rendererSections,
        sectionsAfterRenderers,
    );

    console.log(getUsage(sections));
}
