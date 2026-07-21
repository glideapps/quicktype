import type { RenderContext } from "../../Renderer.js";
import {
    BooleanOption,
    EnumOption,
    StringOption,
    getOptionValues,
} from "../../RendererOptions/index.js";
import {
    type IntegerRange,
    JS_SAFE_INTEGER_RANGE,
} from "../../support/IntegerRange.js";
import { TargetLanguage } from "../../TargetLanguage.js";
import type { LanguageName, RendererOptions } from "../../types.js";

import { ElmRenderer } from "./ElmRenderer.js";

export const elmOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    useList: new EnumOption(
        "array-type",
        "Use Array or List",
        {
            array: false,
            list: true,
        } as const,
        "list",
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

    // Elm compiles to JavaScript, where `Int` is an IEEE-754 double at
    // runtime, so integers are only exact within the JS safe range.
    public getSupportedIntegerRange(): IntegerRange | null {
        return JS_SAFE_INTEGER_RANGE;
    }

    protected makeRenderer<Lang extends LanguageName = "elm">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): ElmRenderer {
        return new ElmRenderer(
            this,
            renderContext,
            getOptionValues(elmOptions, untypedOptionValues),
        );
    }
}
