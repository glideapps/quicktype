import { exceptionToString } from "@glideapps/ts-necessities";
import commandLineArgs from "command-line-args";
import _ from "lodash";

import {
    type OptionDefinition,
    type RendererOptions,
    type TargetLanguage,
    assert,
    defaultTargetLanguages,
    getTargetLanguage,
    isLanguageName,
    messageError,
} from "quicktype-core";

import { inferCLIOptions } from "./inference";
import {
    makeOptionDefinitions,
    transformDefinition,
} from "./optionDefinitions";
import type { CLIOptions } from "./CLIOptions.types";

// Parse the options in argv and split them into global options and renderer options,
// according to each option definition's `renderer` field.  If `partial` is false this
// will throw if it encounters an unknown option.
export function parseOptions(
    definitions: OptionDefinition[],
    argv: string[],
    partial: boolean,
): Partial<CLIOptions> {
    let opts: commandLineArgs.CommandLineOptions;
    try {
        opts = commandLineArgs(definitions.map(transformDefinition), {
            argv,
            partial,
        });
    } catch (e) {
        assert(!partial, "Partial option parsing should not have failed");
        return messageError("DriverCLIOptionParsingFailed", {
            message: exceptionToString(e),
        });
    }

    for (const k of Object.keys(opts)) {
        if (opts[k] === null) {
            return messageError("DriverCLIOptionParsingFailed", {
                message: `Missing value for command line option "${k}"`,
            });
        }
    }

    const options: {
        [key: string]: unknown;
        rendererOptions: RendererOptions;
    } = { rendererOptions: {} };
    for (const optionDefinition of definitions) {
        if (!(optionDefinition.name in opts)) {
            continue;
        }

        const optionValue = opts[optionDefinition.name] as string;
        if (optionDefinition.kind !== "cli") {
            (
                options.rendererOptions as Record<
                    typeof optionDefinition.name,
                    unknown
                >
            )[optionDefinition.name] = optionValue;
        }
        // Inference flags
        else {
            const k = _.lowerFirst(
                optionDefinition.name.split("-").map(_.upperFirst).join(""),
            );
            options[k] = optionValue;
        }
    }

    return options;
}

export function parseCLIOptions(
    argv: string[],
    inputTargetLanguage?: TargetLanguage,
): CLIOptions {
    if (argv.length === 0) {
        return inferCLIOptions({ help: true }, inputTargetLanguage);
    }

    const targetLanguages = inputTargetLanguage
        ? [inputTargetLanguage]
        : defaultTargetLanguages;
    const optionDefinitions = makeOptionDefinitions(targetLanguages);

    // We can only fully parse the options once we know which renderer is selected,
    // because there are renderer-specific options.  But we only know which renderer
    // is selected after we've parsed the options.  Hence, we parse the options
    // twice.  This is the first parse to get the renderer:
    const incompleteOptions = inferCLIOptions(
        parseOptions(optionDefinitions, argv, true),
        inputTargetLanguage,
    );

    let targetLanguage = inputTargetLanguage as TargetLanguage;
    if (inputTargetLanguage === undefined) {
        const languageName = isLanguageName(incompleteOptions.lang)
            ? incompleteOptions.lang
            : "typescript";
        targetLanguage = getTargetLanguage(languageName);
    }

    const rendererOptionDefinitions =
        targetLanguage.cliOptionDefinitions.actual;
    // Use the global options as well as the renderer options from now on:
    const allOptionDefinitions = _.concat(
        optionDefinitions,
        rendererOptionDefinitions,
    );
    // This is the parse that counts:
    return inferCLIOptions(
        parseOptions(allOptionDefinitions, argv, false),
        targetLanguage,
    );
}
