import { EnumOption } from "../RendererOptions";
export declare const acronyms: string[];
export declare enum AcronymStyleOptions {
    Pascal = "pascal",
    Camel = "camel",
    Original = "original",
    Lower = "lowerCase"
}
export declare const acronymOption: (defaultOption: AcronymStyleOptions) => EnumOption<AcronymStyleOptions>;
export declare function acronymStyle(style: AcronymStyleOptions): (s: string) => string;
