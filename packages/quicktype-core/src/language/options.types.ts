import { type OptionMap } from "../RendererOptions";

import { type LanguageDisplayNameMap } from "./types";

export type LanguageRawOptionMap = Readonly<{
    [Lang in keyof LanguageDisplayNameMap]: ReturnType<LanguageDisplayNameMap[Lang]["getOptions"]>;
}>;

export type LanguageOptionMap = Readonly<{
    [Lang in keyof LanguageRawOptionMap]: OptionMap<LanguageRawOptionMap[Lang]>;
}>;
