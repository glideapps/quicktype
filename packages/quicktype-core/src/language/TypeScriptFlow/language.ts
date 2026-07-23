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
import { javaScriptOptions } from "../JavaScript/index.js";

import { FlowRenderer } from "./FlowRenderer.js";
import { TypeScriptRenderer } from "./TypeScriptRenderer.js";

export const tsFlowOptions = {
    ...javaScriptOptions,
    justTypes: new BooleanOption("just-types", "Interfaces only", false),
    nicePropertyNames: new BooleanOption(
        "nice-property-names",
        "Transform property names to be JavaScripty",
        false,
    ),
    declareUnions: new BooleanOption(
        "explicit-unions",
        "Explicitly name unions",
        false,
    ),
    preferUnions: new BooleanOption(
        "prefer-unions",
        "Use union type instead of enum",
        true,
    ),
    preferTypes: new BooleanOption(
        "prefer-types",
        "Use types instead of interfaces",
        false,
    ),
    preferConstValues: new BooleanOption(
        "prefer-const-values",
        "Use string instead of enum for string enums with single value",
        false,
    ),
    readonly: new BooleanOption("readonly", "Use readonly type members", false),
    preferUnknown: new BooleanOption(
        "prefer-unknown",
        "Use unknown (TypeScript) or mixed (Flow) instead of any",
        true,
    ),
};

export const typeScriptLanguageConfig = {
    displayName: "TypeScript",
    names: ["typescript", "ts", "tsx"],
    extension: "ts",
} as const;

export class TypeScriptTargetLanguage extends TargetLanguage<
    typeof typeScriptLanguageConfig
> {
    public getSupportedIntegerRange(): IntegerRange | null {
        return JS_SAFE_INTEGER_RANGE;
    }

    public constructor() {
        super(typeScriptLanguageConfig);
    }

    public getOptions(): typeof tsFlowOptions {
        return tsFlowOptions;
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> =
            new Map();
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

    protected makeRenderer<Lang extends LanguageName = "typescript">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): TypeScriptRenderer {
        return new TypeScriptRenderer(
            this,
            renderContext,
            getOptionValues(tsFlowOptions, untypedOptionValues),
        );
    }
}

export const flowLanguageConfig = {
    displayName: "Flow",
    names: ["flow"],
    extension: "js",
} as const;

export class FlowTargetLanguage extends TargetLanguage<
    typeof flowLanguageConfig
> {
    public getSupportedIntegerRange(): IntegerRange | null {
        return JS_SAFE_INTEGER_RANGE;
    }

    public constructor() {
        super(flowLanguageConfig);
    }

    public getOptions(): typeof tsFlowOptions {
        return tsFlowOptions;
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> =
            new Map();
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

    protected makeRenderer<Lang extends LanguageName = "flow">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): FlowRenderer {
        return new FlowRenderer(
            this,
            renderContext,
            getOptionValues(tsFlowOptions, untypedOptionValues),
        );
    }
}
