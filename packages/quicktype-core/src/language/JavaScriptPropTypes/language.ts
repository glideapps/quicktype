import type { RenderContext } from "../../Renderer.js";
import { EnumOption, getOptionValues } from "../../RendererOptions/index.js";
import { AcronymStyleOptions, acronymOption } from "../../support/Acronyms.js";
import { convertersOption } from "../../support/Converters.js";
import {
    JS_SAFE_INTEGER_RANGE,
    type IntegerRange,
} from "../../support/IntegerRange.js";
import { TargetLanguage } from "../../TargetLanguage.js";
import type { LanguageName, RendererOptions } from "../../types.js";

import { JavaScriptPropTypesRenderer } from "./JavaScriptPropTypesRenderer.js";

export const javaScriptPropTypesOptions = {
    acronymStyle: acronymOption(AcronymStyleOptions.Pascal),
    converters: convertersOption(),
    moduleSystem: new EnumOption(
        "module-system",
        "Which module system to use",
        {
            "common-js": false,
            es6: true,
        } as const,
        "es6",
    ),
};

export const javaScriptPropTypesLanguageConfig = {
    displayName: "JavaScript PropTypes",
    names: ["javascript-prop-types"],
    extension: "js",
} as const;

export class JavaScriptPropTypesTargetLanguage extends TargetLanguage<
    typeof javaScriptPropTypesLanguageConfig
> {
    public getSupportedIntegerRange(): IntegerRange | null {
        return JS_SAFE_INTEGER_RANGE;
    }

    public constructor() {
        super(javaScriptPropTypesLanguageConfig);
    }

    public getOptions(): typeof javaScriptPropTypesOptions {
        return javaScriptPropTypesOptions;
    }

    protected makeRenderer<Lang extends LanguageName = "javascript-prop-types">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): JavaScriptPropTypesRenderer {
        return new JavaScriptPropTypesRenderer(
            this,
            renderContext,
            getOptionValues(javaScriptPropTypesOptions, untypedOptionValues),
        );
    }
}
