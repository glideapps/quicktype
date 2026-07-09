import type { RenderContext } from "../../Renderer";
import { EnumOption, getOptionValues } from "../../RendererOptions";
import { AcronymStyleOptions, acronymOption } from "../../support/Acronyms";
import { convertersOption } from "../../support/Converters";
import { TargetLanguage } from "../../TargetLanguage";
import type { LanguageName, RendererOptions } from "../../types";

import { JavaScriptPropTypesRenderer } from "./JavaScriptPropTypesRenderer";

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
