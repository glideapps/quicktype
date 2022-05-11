import { Readable } from "readable-stream";
import { Options, RendererOptions, SerializedRenderResult, TargetLanguage, JSONInput } from "../quicktype-core";
export interface CLIOptions {
    lang: string;
    topLevel: string;
    src: string[];
    srcUrls?: string;
    srcLang: string;
    additionalSchema: string[];
    graphqlSchema?: string;
    graphqlIntrospect?: string;
    httpHeader?: string[];
    httpMethod?: string;
    out?: string;
    buildMarkovChain?: string;
    alphabetizeProperties: boolean;
    allPropertiesOptional: boolean;
    noRender: boolean;
    rendererOptions: RendererOptions;
    help: boolean;
    quiet: boolean;
    version: boolean;
    debug?: string;
    telemetry?: string;
    [option: string]: any;
}
export declare function parseCLIOptions(argv: string[], targetLanguage?: TargetLanguage): CLIOptions;
export declare function jsonInputForTargetLanguage(targetLanguage: string | TargetLanguage, languages?: TargetLanguage[], handleJSONRefs?: boolean): JSONInput<Readable>;
export declare function makeQuicktypeOptions(options: CLIOptions, targetLanguages?: TargetLanguage[]): Promise<Partial<Options> | undefined>;
export declare function writeOutput(cliOptions: CLIOptions, resultsByFilename: ReadonlyMap<string, SerializedRenderResult>): void;
export declare function main(args: string[] | Partial<CLIOptions>): Promise<void>;