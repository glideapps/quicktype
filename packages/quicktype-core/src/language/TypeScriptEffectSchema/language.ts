import { type RenderContext } from "../../Renderer";
import { BooleanOption, type Option, getOptionValues } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { TypeScriptEffectSchemaRenderer } from "./TypeScriptEffectSchemaRenderer";

export const typeScriptEffectSchemaOptions = {
    justSchema: new BooleanOption("just-schema", "Schema only", false)
};

export class TypeScriptEffectSchemaTargetLanguage extends TargetLanguage {
    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [];
    }

    public constructor(
        displayName: string = "TypeScript Effect Schema",
        names: string[] = ["typescript-effect-schema"],
        extension: string = "ts"
    ) {
        super(displayName, names, extension);
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
