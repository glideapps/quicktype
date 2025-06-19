import * as path from "node:path";

import { withDefault } from "collection-utils";

import {
    type LanguageName,
    type TargetLanguage,
    inferenceFlagNames,
    isLanguageName,
    languageNamed,
    messageAssert,
    messageError,
} from "quicktype-core";

import { negatedInferenceFlagName } from "./utils";
import type { CLIOptions } from "./CLIOptions.types";

const defaultTargetLanguageName = "go";

function inferLang(
    options: Partial<CLIOptions>,
    defaultLanguage: LanguageName,
): string | LanguageName {
    // Output file extension determines the language if language is undefined
    if (options.out !== undefined) {
        const extension = path.extname(options.out);
        if (extension === "") {
            return messageError("DriverNoLanguageOrExtension", {});
        }

        return extension.slice(1);
    }

    return defaultLanguage;
}

function inferTopLevel(options: Partial<CLIOptions>): string {
    // Output file name determines the top-level if undefined
    if (options.out !== undefined) {
        const extension = path.extname(options.out);
        const without = path.basename(options.out).replace(extension, "");
        return without;
    }

    // Source determines the top-level if undefined
    if (options.src !== undefined && options.src.length === 1) {
        const src = options.src[0];
        const extension = path.extname(src);
        const without = path.basename(src).replace(extension, "");
        return without;
    }

    return "TopLevel";
}

export function inferCLIOptions(
    opts: Partial<CLIOptions>,
    targetLanguage: TargetLanguage | undefined,
): CLIOptions {
    let srcLang = opts.srcLang;
    if (
        opts.graphqlSchema !== undefined ||
        opts.graphqlIntrospect !== undefined
    ) {
        messageAssert(
            srcLang === undefined || srcLang === "graphql",
            "DriverSourceLangMustBeGraphQL",
            {},
        );
        srcLang = "graphql";
    } else if (
        opts.src !== undefined &&
        opts.src.length > 0 &&
        opts.src.every((file) => file.endsWith(".ts"))
    ) {
        srcLang = "typescript";
    } else {
        messageAssert(srcLang !== "graphql", "DriverGraphQLSchemaNeeded", {});
        srcLang = withDefault<string>(srcLang, "json");
    }

    let language: TargetLanguage;
    if (targetLanguage !== undefined) {
        language = targetLanguage;
    } else {
        const languageName =
            opts.lang ?? inferLang(opts, defaultTargetLanguageName);

        if (isLanguageName(languageName)) {
            language = languageNamed(languageName);
        } else {
            return messageError("DriverUnknownOutputLanguage", {
                lang: languageName,
            });
        }
    }

    const options: CLIOptions = {
        src: opts.src ?? [],
        srcUrls: opts.srcUrls,
        srcLang: srcLang,
        lang: language.name as LanguageName,
        topLevel: opts.topLevel ?? inferTopLevel(opts),
        noRender: !!opts.noRender,
        alphabetizeProperties: !!opts.alphabetizeProperties,
        allPropertiesOptional: !!opts.allPropertiesOptional,
        rendererOptions: opts.rendererOptions ?? {},
        help: opts.help ?? false,
        quiet: opts.quiet ?? false,
        version: opts.version ?? false,
        out: opts.out,
        buildMarkovChain: opts.buildMarkovChain,
        additionalSchema: opts.additionalSchema ?? [],
        graphqlSchema: opts.graphqlSchema,
        graphqlIntrospect: opts.graphqlIntrospect,
        httpMethod: opts.httpMethod,
        httpHeader: opts.httpHeader,
        debug: opts.debug,
        telemetry: opts.telemetry,
    };
    for (const flagName of inferenceFlagNames) {
        const cliName = negatedInferenceFlagName(flagName);
        options[cliName] = !!opts[cliName];
        options[flagName] = !opts[cliName];
    }

    return options;
}
