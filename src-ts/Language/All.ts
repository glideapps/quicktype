import { TargetLanguage, PureScriptTargetLanguage } from "../TargetLanguage";
import * as Renderers from "Language.Renderers";

import { cSharpTargetLanguage } from "./CSharp";
import simpleTypesTargetLanguage from "./SimpleTypes";

const typeScriptTargetLanguages: TargetLanguage[] = [
    cSharpTargetLanguage,
    simpleTypesTargetLanguage
];

const pureScriptTargetLanguages: TargetLanguage[] = Renderers.all.map(
    r => new PureScriptTargetLanguage(r)
);

export default typeScriptTargetLanguages.concat(pureScriptTargetLanguages);
