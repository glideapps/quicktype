import type { LanguageName, RendererOptions } from "quicktype-core";

export interface CLIOptions<Lang extends LanguageName = LanguageName> {
    // We use this to access the inference flags
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    [option: string]: any;
    additionalSchema: string[];
    allPropertiesOptional: boolean;
    alphabetizeProperties: boolean;
    buildMarkovChain?: string;
    debug?: string;
    graphqlIntrospect?: string;
    graphqlSchema?: string;
    help: boolean;
    httpHeader?: string[];
    httpMethod?: string;
    lang: Lang;

    noRender: boolean;
    out?: string;
    quiet: boolean;

    rendererOptions: RendererOptions<Lang>;

    src: string[];
    srcLang: string;
    srcUrls?: string;
    telemetry?: string;
    topLevel: string;

    version: boolean;
}
