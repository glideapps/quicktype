import { type RenderContext } from "../../Renderer";
import { BooleanOption, getOptionValues } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type PrimitiveStringTypeKind, type TransformedStringTypeKind } from "../../Type";
import { type StringTypeMapping } from "../../TypeBuilder";
import { type FixMeOptionsType } from "../../types";
import { javaScriptOptions } from "../JavaScript";

import { FlowRenderer } from "./FlowRenderer";
import { TypeScriptRenderer } from "./TypeScriptRenderer";

export const tsFlowOptions = Object.assign({}, javaScriptOptions, {
    justTypes: new BooleanOption("just-types", "Interfaces only", false),
    nicePropertyNames: new BooleanOption("nice-property-names", "Transform property names to be JavaScripty", false),
    declareUnions: new BooleanOption("explicit-unions", "Explicitly name unions", false),
    preferUnions: new BooleanOption("prefer-unions", "Use union type instead of enum", false),
    preferTypes: new BooleanOption("prefer-types", "Use types instead of interfaces", false),
    preferConstValues: new BooleanOption(
        "prefer-const-values",
        "Use string instead of enum for string enums with single value",
        false
    ),
    readonly: new BooleanOption("readonly", "Use readonly type members", false)
});

export const typeScriptLanguageConfig = {
    displayName: "TypeScript",
    names: ["typescript", "ts", "tsx"],
    extension: "ts"
} as const;

export class TypeScriptTargetLanguage extends TargetLanguage<typeof typeScriptLanguageConfig> {
    public constructor() {
        super(typeScriptLanguageConfig);
    }

    public getOptions(): typeof tsFlowOptions {
        return tsFlowOptions;
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> = new Map();
        const dateTimeType = "date-time";
        mapping.set("date", dateTimeType);
        mapping.set("date-time", dateTimeType);
        return mapping;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsFullObjectType(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): TypeScriptRenderer {
        return new TypeScriptRenderer(this, renderContext, getOptionValues(tsFlowOptions, untypedOptionValues));
    }
}

export const flowLanguageConfig = {
    displayName: "Flow",
    names: ["flow"],
    extension: "js"
} as const;

export class FlowTargetLanguage extends TargetLanguage<typeof flowLanguageConfig> {
    public constructor() {
        super(flowLanguageConfig);
    }

    public getOptions(): typeof tsFlowOptions {
        return tsFlowOptions;
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> = new Map();
        const dateTimeType = "date-time";
        mapping.set("date", dateTimeType);
        mapping.set("date-time", dateTimeType);
        return mapping;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsFullObjectType(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): FlowRenderer {
        return new FlowRenderer(this, renderContext, getOptionValues(tsFlowOptions, untypedOptionValues));
    }
}
