import type { RenderContext } from "../../Renderer";
import { BooleanOption, getOptionValues } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import type {
    PrimitiveStringTypeKind,
    TransformedStringTypeKind,
} from "../../Type";
import type { StringTypeMapping } from "../../Type/TypeBuilderUtils";
import type { LanguageName, RendererOptions } from "../../types";

import { TypeScriptZodRenderer } from "./TypeScriptZodRenderer";

export const typeScriptZodOptions = {
    justSchema: new BooleanOption("just-schema", "Schema only", false),
};

export const typeScriptZodLanguageConfig = {
    displayName: "TypeScript Zod",
    names: ["typescript-zod"],
    extension: "ts",
} as const;

export class TypeScriptZodTargetLanguage extends TargetLanguage<
    typeof typeScriptZodLanguageConfig
> {
    public constructor() {
        super(typeScriptZodLanguageConfig);
    }

    public getOptions(): {} {
        return {};
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> =
            new Map();
        const dateTimeType = "date-time";
        mapping.set("date-time", dateTimeType);
        return mapping;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected makeRenderer<Lang extends LanguageName = "typescript-zod">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): TypeScriptZodRenderer {
        return new TypeScriptZodRenderer(
            this,
            renderContext,
            getOptionValues(typeScriptZodOptions, untypedOptionValues),
        );
    }
}
