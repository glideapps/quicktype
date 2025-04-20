import type { OptionMap } from "../RendererOptions";

import type { LanguageName, LanguageNameMap } from "./types";

export type LanguageRawOptionMap = Readonly<{
    [Lang in keyof LanguageNameMap]: ReturnType<LanguageNameMap[Lang]["getOptions"]>;
}>;

export type LanguageOptionMap = Readonly<{
    [Lang in keyof LanguageRawOptionMap]: OptionMap<LanguageRawOptionMap[Lang]>;
}>;

export type RendererOptions<Lang extends LanguageName = LanguageName, Options = LanguageOptionMap[Lang]> = {
    -readonly [K in keyof Options]: Options[K];
};
