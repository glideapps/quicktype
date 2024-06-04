import { type RenderContext } from "../../Renderer";
import { EnumOption, type Option, getOptionValues } from "../../RendererOptions";
import { AcronymStyleOptions, acronymOption } from "../../support/Acronyms";
import { convertersOption } from "../../support/Converters";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { JavaScriptPropTypesRenderer } from "./JavaScriptPropTypesRenderer";

export const javaScriptPropTypesOptions = {
    acronymStyle: acronymOption(AcronymStyleOptions.Pascal),
    converters: convertersOption(),
    moduleSystem: new EnumOption(
        "module-system",
        "Which module system to use",
        {
            "common-js": false,
            "es6": true
        } as const,
        "es6"
    )
};

export const javaScriptPropTypesLanguageConfig = {
    displayName: "JavaScript PropTypes",
    names: ["javascript-prop-types"],
    extension: "js"
} as const;

export class JavaScriptPropTypesTargetLanguage extends TargetLanguage<typeof javaScriptPropTypesLanguageConfig> {
    public constructor() {
        super(javaScriptPropTypesLanguageConfig);
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [javaScriptPropTypesOptions.acronymStyle, javaScriptPropTypesOptions.converters];
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: FixMeOptionsType
    ): JavaScriptPropTypesRenderer {
        return new JavaScriptPropTypesRenderer(
            this,
            renderContext,
            getOptionValues(javaScriptPropTypesOptions, untypedOptionValues)
        );
    }
}
