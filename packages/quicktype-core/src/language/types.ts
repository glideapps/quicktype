import type { TargetLanguage } from "../TargetLanguage.js";

import type { all } from "./All.js";

type AllLanguages = (typeof all)[number];

/** The display name of a built-in target language, e.g. `"C++"` or `"TypeScript"`. */
export type LanguageDisplayName<
    Language extends TargetLanguage = AllLanguages,
> = Language["displayName"];
/**
 * The union of all name aliases of the built-in target languages, e.g.
 * `"c++"`, `"ts"`, `"typescript"`.  This is what `quicktype`'s `lang`
 * option and `jsonInputForTargetLanguage` accept instead of `string`.
 *
 * To use a runtime `string` where a `LanguageName` is expected, narrow
 * it with the `isLanguageName` type guard rather than casting.
 */
export type LanguageName<Language extends TargetLanguage = AllLanguages> =
    Language["names"][number];

export type LanguageDisplayNameMap = {
    [Language in AllLanguages as LanguageDisplayName<Language>]: Language;
};
export type LanguageNameMap = {
    [Language in AllLanguages as LanguageName<Language>]: Language;
};
