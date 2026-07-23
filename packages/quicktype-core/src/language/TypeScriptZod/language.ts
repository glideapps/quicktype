import type { RenderContext } from "../../Renderer.js";
import { BooleanOption, getOptionValues } from "../../RendererOptions/index.js";
import {
    JS_SAFE_INTEGER_RANGE,
    type IntegerRange,
} from "../../support/IntegerRange.js";
import { TargetLanguage } from "../../TargetLanguage.js";
import type { StringTypeMapping } from "../../Type/TypeBuilderUtils.js";
import type {
    PrimitiveStringTypeKind,
    TransformedStringTypeKind,
} from "../../Type/index.js";
import type { LanguageName, RendererOptions } from "../../types.js";

import { TypeScriptZodRenderer } from "./TypeScriptZodRenderer.js";

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
    public getSupportedIntegerRange(): IntegerRange | null {
        return JS_SAFE_INTEGER_RANGE;
    }

    public constructor() {
        super(typeScriptZodLanguageConfig);
    }

    public getOptions(): Record<string, never> {
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
