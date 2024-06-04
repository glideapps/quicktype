import { type OptionMap } from "../RendererOptions";

import { type LanguageNameMap } from "./types";

export type LanguageRawOptionMap = Readonly<{
    [Lang in keyof LanguageNameMap]: ReturnType<LanguageNameMap[Lang]["getOptions"]>;
}>;

export type LanguageOptionMap = Readonly<{
    [Lang in keyof LanguageRawOptionMap]: OptionMap<LanguageRawOptionMap[Lang]>;
}>;
