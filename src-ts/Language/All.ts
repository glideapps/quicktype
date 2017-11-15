import { find, includes } from "lodash";

import { TargetLanguage, PureScriptTargetLanguage } from "../TargetLanguage";
import { EnumOption, OptionDefinition } from "../RendererOptions";
import { fromJust } from "../purescript";
import { Config } from "Config";
import { SerializedRenderResult } from "../Source";
import { assertNever } from "../Support";
import * as Renderers from "Language.Renderers";

import CSharpTargetLanguage from "./CSharp";
import GoTargetLanguage from "./Golang";
import CPlusPlusTargetLanguage from "./CPlusPlus";
import JavaTargetLanguage from "./Java";
import SimpleTypesTargetLanguage from "./SimpleTypes";
import TypeScriptTargetLanguage from "./TypeScript";
import Swift4TargetLanguage from "./Swift";

enum SwiftVersion {
    Swift3,
    Swift4
}

class SwiftTargetLanguage extends TargetLanguage {
    private readonly _versionOption: EnumOption<SwiftVersion>;
    private readonly _swift3: TargetLanguage;
    private readonly _swift4: TargetLanguage;

    constructor() {
        const versionOption = new EnumOption("swift-version", "Swift version", [
            ["4", SwiftVersion.Swift4],
            ["3", SwiftVersion.Swift3]
        ]);
        const swift4 = new Swift4TargetLanguage();
        const optionDefinitions = [versionOption.definition].concat(swift4.optionDefinitions);
        super("Swift", ["swift"], "swift", optionDefinitions);
        this._versionOption = versionOption;
        this._swift3 = new PureScriptTargetLanguage(fromJust(Renderers.rendererForLanguage("swift3")));
        this._swift4 = swift4;
    }

    transformAndRenderConfig(config: Config): SerializedRenderResult {
        const version = this._versionOption.getValue(config.rendererOptions);
        switch (version) {
            case SwiftVersion.Swift4:
                return this._swift4.transformAndRenderConfig(config);
            case SwiftVersion.Swift3:
                return this._swift3.transformAndRenderConfig(config);
            default:
                return assertNever(version);
        }
    }
}

const typeScriptTargetLanguages: TargetLanguage[] = [
    new CSharpTargetLanguage(),
    new GoTargetLanguage(),
    new CPlusPlusTargetLanguage(),
    new JavaTargetLanguage(),
    new TypeScriptTargetLanguage(),
    new SwiftTargetLanguage(),
    new SimpleTypesTargetLanguage()
];

const pureScriptTargetLanguages: TargetLanguage[] = Renderers.all
    .filter(r => r.names[0] !== "swift3")
    .map(r => new PureScriptTargetLanguage(r));

export const all = typeScriptTargetLanguages.concat(pureScriptTargetLanguages);

export function languageNamed(name: string): TargetLanguage | undefined {
    return find(all, l => includes(l.names, name) || l.displayName === name);
}
