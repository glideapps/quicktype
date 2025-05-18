import type { RenderContext } from "../../Renderer";
import {
    BooleanOption,
    EnumOption,
    StringOption,
    getOptionValues,
} from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import type { LanguageName, RendererOptions } from "../../types";

import { HaskellRenderer } from "./HaskellRenderer";

export const haskellOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    useList: new EnumOption(
        "array-type",
        "Use Array or List",
        {
            array: false,
            list: true,
        } as const,
        "array",
    ),
    moduleName: new StringOption(
        "module",
        "Generated module name",
        "NAME",
        "QuickType",
    ),
};

export const haskellLanguageConfig = {
    displayName: "Haskell",
    names: ["haskell"],
    extension: "haskell",
} as const;

export class HaskellTargetLanguage extends TargetLanguage<
    typeof haskellLanguageConfig
> {
    public constructor() {
        super(haskellLanguageConfig);
    }

    public getOptions(): typeof haskellOptions {
        return haskellOptions;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer<Lang extends LanguageName = "haskell">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): HaskellRenderer {
        return new HaskellRenderer(
            this,
            renderContext,
            getOptionValues(haskellOptions, untypedOptionValues),
        );
    }
}
