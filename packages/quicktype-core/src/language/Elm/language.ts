import type { RenderContext } from "../../Renderer";
import {
    BooleanOption,
    EnumOption,
    StringOption,
    getOptionValues,
} from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import type { FixMeOptionsType } from "../../types";

import { ElmRenderer } from "./ElmRenderer";

export const elmOptions = {
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
    // FIXME: Do this via a configurable named eventually.
    moduleName: new StringOption(
        "module",
        "Generated module name",
        "NAME",
        "QuickType",
    ),
};

export const elmLanguageConfig = {
    displayName: "Elm",
    names: ["elm"],
    extension: "elm",
} as const;

export class ElmTargetLanguage extends TargetLanguage<
    typeof elmLanguageConfig
> {
    public constructor() {
        super(elmLanguageConfig);
    }

    public getOptions(): typeof elmOptions {
        return elmOptions;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: FixMeOptionsType,
    ): ElmRenderer {
        return new ElmRenderer(
            this,
            renderContext,
            getOptionValues(elmOptions, untypedOptionValues),
        );
    }
}
