import { type RenderContext } from "../../Renderer";
import { BooleanOption, type Option, getOptionValues } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { TypeScriptEffectSchemaRenderer } from "./TypeScriptEffectSchemaRenderer";

export const typeScriptEffectSchemaOptions = {
    justSchema: new BooleanOption("just-schema", "Schema only", false)
};

export const typeScriptEffectSchemaLanguageConfig = {
    displayName: "TypeScript Effect Schema",
    names: ["typescript-effect-schema"],
    extension: "ts"
} as const;

export class TypeScriptEffectSchemaTargetLanguage extends TargetLanguage<typeof typeScriptEffectSchemaLanguageConfig> {
    public constructor() {
        super(typeScriptEffectSchemaLanguageConfig);
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [];
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: FixMeOptionsType
    ): TypeScriptEffectSchemaRenderer {
        return new TypeScriptEffectSchemaRenderer(
            this,
            renderContext,
            getOptionValues(typeScriptEffectSchemaOptions, untypedOptionValues)
        );
    }
}
