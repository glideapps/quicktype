import { type RenderContext } from "../../Renderer";
import { BooleanOption, type Option, getOptionValues } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type PrimitiveStringTypeKind, type TransformedStringTypeKind } from "../../Type";
import { type StringTypeMapping } from "../../TypeBuilder";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { TypeScriptZodRenderer } from "./TypeScriptZodRenderer";

export const typeScriptZodOptions = {
    justSchema: new BooleanOption("just-schema", "Schema only", false)
};

export class TypeScriptZodTargetLanguage extends TargetLanguage {
    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [];
    }

    public constructor(
        displayName: string = "TypeScript Zod",
        names: string[] = ["typescript-zod"],
        extension: string = "ts"
    ) {
        super(displayName, names, extension);
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> = new Map();
        const dateTimeType = "date-time";
        mapping.set("date-time", dateTimeType);
        return mapping;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): TypeScriptZodRenderer {
        return new TypeScriptZodRenderer(
            this,
            renderContext,
            getOptionValues(typeScriptZodOptions, untypedOptionValues)
        );
    }
}
