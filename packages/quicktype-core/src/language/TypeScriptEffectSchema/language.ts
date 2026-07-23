import type { RenderContext } from "../../Renderer.js";
import { BooleanOption, getOptionValues } from "../../RendererOptions/index.js";
import {
    JS_SAFE_INTEGER_RANGE,
    type IntegerRange,
} from "../../support/IntegerRange.js";
import { TargetLanguage } from "../../TargetLanguage.js";
import type { LanguageName, RendererOptions } from "../../types.js";

import { TypeScriptEffectSchemaRenderer } from "./TypeScriptEffectSchemaRenderer.js";

export const typeScriptEffectSchemaOptions = {
    justSchema: new BooleanOption("just-schema", "Schema only", false),
};

export const typeScriptEffectSchemaLanguageConfig = {
    displayName: "TypeScript Effect Schema",
    names: ["typescript-effect-schema"],
    extension: "ts",
} as const;

export class TypeScriptEffectSchemaTargetLanguage extends TargetLanguage<
    typeof typeScriptEffectSchemaLanguageConfig
> {
    public getSupportedIntegerRange(): IntegerRange | null {
        return JS_SAFE_INTEGER_RANGE;
    }

    public constructor() {
        super(typeScriptEffectSchemaLanguageConfig);
    }

    public getOptions(): Record<string, never> {
        return {};
    }

    protected makeRenderer<
        Lang extends LanguageName = "typescript-effect-schema",
    >(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): TypeScriptEffectSchemaRenderer {
        return new TypeScriptEffectSchemaRenderer(
            this,
            renderContext,
            getOptionValues(typeScriptEffectSchemaOptions, untypedOptionValues),
        );
    }
}
