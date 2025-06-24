import type {
    LanguageName,
    RendererOptions,
    InferenceFlagName,
} from "quicktype-core";

type CamelToPascal<T extends string> =
    T extends `${infer FirstChar}${infer Rest}`
        ? `${Capitalize<FirstChar>}${Rest}`
        : never;

export type NegatedInferenceFlagName<
    Input extends InferenceFlagName = InferenceFlagName,
> = `no${CamelToPascal<Input extends `infer${infer Name}` ? Name : Input>}`;

export interface CLIOptions<Lang extends LanguageName = LanguageName>
    extends Partial<
        Record<InferenceFlagName | NegatedInferenceFlagName, boolean>
    > {
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
    telemetry?: "enable" | "disable";
    topLevel: string;

    version: boolean;
}
