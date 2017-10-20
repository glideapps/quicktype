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

export default typeScriptTargetLanguages.concat(pureScriptTargetLanguages);
