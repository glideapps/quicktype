import { mapFromObject, mapMap } from "collection-utils";

import {
    type OptionDefinition,
    type TargetLanguage,
    inferenceFlags,
} from "quicktype-core";

import { dashedFromCamelCase, negatedInferenceFlagName } from "./utils";

export function makeOptionDefinitions(
    targetLanguages: readonly TargetLanguage[],
): OptionDefinition[] {
    const beforeLang: OptionDefinition[] = [
        {
            name: "out",
            alias: "o",
            optionType: "string",
            typeLabel: "FILE",
            description: "The output file. Determines --lang and --top-level.",
            kind: "cli",
            defaultOption: true,
        },
        {
            name: "top-level",
            alias: "t",
            optionType: "string",
            typeLabel: "NAME",
            description: "The name for the top level type.",
            kind: "cli",
        },
    ];
    const lang: OptionDefinition[] =
        targetLanguages.length < 2
            ? []
            : [
                  {
                      name: "lang",
                      alias: "l",
                      optionType: "string",
                      typeLabel: "LANG",
                      description: "The target language.",
                      kind: "cli",
                  },
              ];
    const afterLang: OptionDefinition[] = [
        {
            name: "src-lang",
            alias: "s",
            optionType: "string",
            defaultValue: undefined,
            typeLabel: "SRC_LANG",
            description: "The source language (default is json).",
            kind: "cli",
        },
        {
            name: "src",
            optionType: "string",
            multiple: true,
            typeLabel: "FILE|URL|DIRECTORY",
            description: "The file, url, or data directory to type.",
            kind: "cli",
        },
        {
            name: "src-urls",
            optionType: "string",
            typeLabel: "FILE",
            description: "Tracery grammar describing URLs to crawl.",
            kind: "cli",
        },
    ];
    const inference: OptionDefinition[] = Array.from(
        mapMap(mapFromObject(inferenceFlags), (flag, name) => {
            return {
                name: dashedFromCamelCase(negatedInferenceFlagName(name)),
                optionType: "boolean" as const,
                // biome-ignore lint/style/useTemplate: <explanation>
                description: flag.negationDescription + ".",
                kind: "cli" as const,
            };
        }).values(),
    );
    const afterInference: OptionDefinition[] = [
        {
            name: "graphql-schema",
            optionType: "string",
            typeLabel: "FILE",
            description: "GraphQL introspection file.",
            kind: "cli",
        },
        {
            name: "graphql-introspect",
            optionType: "string",
            typeLabel: "URL",
            description: "Introspect GraphQL schema from a server.",
            kind: "cli",
        },
        {
            name: "http-method",
            optionType: "string",
            typeLabel: "METHOD",
            description:
                "HTTP method to use for the GraphQL introspection query.",
            kind: "cli",
        },
        {
            name: "http-header",
            optionType: "string",
            multiple: true,
            typeLabel: "HEADER",
            description:
                "Header(s) to attach to all HTTP requests, including the GraphQL introspection query.",
            kind: "cli",
        },
        {
            name: "additional-schema",
            alias: "S",
            optionType: "string",
            multiple: true,
            typeLabel: "FILE",
            description: "Register the $id's of additional JSON Schema files.",
            kind: "cli",
        },
        {
            name: "no-render",
            optionType: "boolean",
            description: "Don't render output.",
            kind: "cli",
        },
        {
            name: "alphabetize-properties",
            optionType: "boolean",
            description: "Alphabetize order of class properties.",
            kind: "cli",
        },
        {
            name: "all-properties-optional",
            optionType: "boolean",
            description: "Make all class properties optional.",
            kind: "cli",
        },
        {
            name: "build-markov-chain",
            optionType: "string",
            typeLabel: "FILE",
            description: "Markov chain corpus filename.",
            kind: "cli",
        },
        {
            name: "quiet",
            optionType: "boolean",
            description: "Don't show issues in the generated code.",
            kind: "cli",
        },
        {
            name: "debug",
            optionType: "string",
            typeLabel: "OPTIONS or all",
            description:
                "Comma separated debug options: print-graph, print-reconstitution, print-gather-names, print-transformations, print-schema-resolving, print-times, provenance",
            kind: "cli",
        },
        {
            name: "telemetry",
            optionType: "string",
            typeLabel: "enable|disable",
            description: "Enable anonymous telemetry to help improve quicktype",
            kind: "cli",
        },
        {
            name: "help",
            alias: "h",
            optionType: "boolean",
            description: "Get some help.",
            kind: "cli",
        },
        {
            name: "version",
            alias: "v",
            optionType: "boolean",
            description: "Display the version of quicktype",
            kind: "cli",
        },
    ];
    return beforeLang.concat(lang, afterLang, inference, afterInference);
}

export const transformDefinition = (def: OptionDefinition) => ({
    ...def,
    type: def.optionType === "boolean" ? Boolean : String,
});
