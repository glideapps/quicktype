import { type all } from "./language/All";
import { type TargetLanguage } from "./TargetLanguage";


type AllLanguages = (typeof all)[number];

export type LanguageDisplayName<Language extends TargetLanguage = AllLanguages> = Language["displayName"];
export type LanguageName<Language extends TargetLanguage = AllLanguages> = Language["names"][number];

export type LanguageDisplayNameMap = {
    [Language in AllLanguages as LanguageDisplayName<Language>]: Language;
};
export type LanguageNameMap = {
    [Language in AllLanguages as LanguageName<Language>]: Language;
};

// FIXME: remove these when options are strongly types

/* eslint-disable @typescript-eslint/no-explicit-any */
export type FixMeOptionsType = Record<string, any>;

export type FixMeOptionsAnyType = any;
