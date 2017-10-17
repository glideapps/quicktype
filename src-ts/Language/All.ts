import { TargetLanguage, PureScriptTargetLanguage } from "../TargetLanguage";
import * as Renderers from "Language.Renderers";

import { cSharpTargetLanguage } from "./CSharp";

const typeScriptTargetLanguages: TargetLanguage[] = [cSharpTargetLanguage];

const pureScriptTargetLanguages: TargetLanguage[] = Renderers.all.map(
    r => new PureScriptTargetLanguage(r)
);

export default typeScriptTargetLanguages.concat(pureScriptTargetLanguages);
