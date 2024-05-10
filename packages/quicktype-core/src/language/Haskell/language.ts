import { type RenderContext } from "../../Renderer";
import { BooleanOption, EnumOption, type Option, StringOption, getOptionValues } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { HaskellRenderer } from "./HaskellRenderer";

export const haskellOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    useList: new EnumOption("array-type", "Use Array or List", [
        ["array", false],
        ["list", true]
    ]),
    moduleName: new StringOption("module", "Generated module name", "NAME", "QuickType")
};

export const haskellLanguageConfig = {
    displayName: "Haskell",
    names: ["haskell"],
    extension: "haskell"
} as const;

export class HaskellTargetLanguage extends TargetLanguage<typeof haskellLanguageConfig> {
    constructor() {
        super(haskellLanguageConfig);
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [haskellOptions.justTypes, haskellOptions.moduleName, haskellOptions.useList];
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): HaskellRenderer {
        return new HaskellRenderer(this, renderContext, getOptionValues(haskellOptions, untypedOptionValues));
    }
}
