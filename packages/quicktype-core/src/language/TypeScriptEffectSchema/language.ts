import type { RenderContext } from "../../Renderer";
import { BooleanOption, getOptionValues } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import type { LanguageName, RendererOptions } from "../../types";

import { TypeScriptEffectSchemaRenderer } from "./TypeScriptEffectSchemaRenderer";

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
    public constructor() {
        super(typeScriptEffectSchemaLanguageConfig);
    }

    public getOptions(): {} {
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
