import { find, includes } from "lodash";

import { TargetLanguage, PureScriptTargetLanguage } from "../TargetLanguage";
import * as Renderers from "Language.Renderers";

import CSharpTargetLanguage from "./CSharp";
import GoTargetLanguage from "./Golang";
import SimpleTypesTargetLanguage from "./SimpleTypes";

const typeScriptTargetLanguages: TargetLanguage[] = [
    new CSharpTargetLanguage(),
    new GoTargetLanguage(),
    new SimpleTypesTargetLanguage()
];

const pureScriptTargetLanguages: TargetLanguage[] = Renderers.all.map(
    r => new PureScriptTargetLanguage(r)
);

export const all = typeScriptTargetLanguages.concat(pureScriptTargetLanguages);

export function languageNamed(name: string): TargetLanguage | undefined {
    return find(all, l => includes(l.names, name) || l.displayName === name);
}
