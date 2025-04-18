import { type RenderContext } from "../../Renderer";
import { BooleanOption, type Option, getOptionValues } from "../../RendererOptions";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";
import { type JavaScriptRenderer, JavaScriptTargetLanguage, javaScriptOptions } from "../JavaScript";

import { FlowRenderer } from "./FlowRenderer";
import { TypeScriptRenderer } from "./TypeScriptRenderer";

export const tsFlowOptions = Object.assign({}, javaScriptOptions, {
    justTypes: new BooleanOption("just-types", "Interfaces only", false),
    nicePropertyNames: new BooleanOption("nice-property-names", "Transform property names to be JavaScripty", false),
    declareUnions: new BooleanOption("explicit-unions", "Explicitly name unions", false),
    preferUnions: new BooleanOption("prefer-unions", "Use union type instead of enum", true),
    preferTypes: new BooleanOption("prefer-types", "Use types instead of interfaces", false),
    preferConstValues: new BooleanOption(
        "prefer-const-values",
        "Use string instead of enum for string enums with single value",
        true
    ),
    readonly: new BooleanOption("readonly", "Use readonly type members", false)
});

export abstract class TypeScriptFlowBaseTargetLanguage extends JavaScriptTargetLanguage {
    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [
            tsFlowOptions.justTypes,
            tsFlowOptions.nicePropertyNames,
            tsFlowOptions.declareUnions,
            tsFlowOptions.runtimeTypecheck,
            tsFlowOptions.runtimeTypecheckIgnoreUnknownProperties,
            tsFlowOptions.acronymStyle,
            tsFlowOptions.converters,
            tsFlowOptions.rawType,
            tsFlowOptions.preferUnions,
            tsFlowOptions.preferTypes,
            tsFlowOptions.preferConstValues,
            tsFlowOptions.readonly
        ];
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected abstract makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: FixMeOptionsType
    ): JavaScriptRenderer;
}

export class TypeScriptTargetLanguage extends TypeScriptFlowBaseTargetLanguage {
    public constructor() {
        super("TypeScript", ["typescript", "ts", "tsx"], "ts");
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): TypeScriptRenderer {
        return new TypeScriptRenderer(this, renderContext, getOptionValues(tsFlowOptions, untypedOptionValues));
    }
}
export class FlowTargetLanguage extends TypeScriptFlowBaseTargetLanguage {
    public constructor() {
        super("Flow", ["flow"], "js");
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): FlowRenderer {
        return new FlowRenderer(this, renderContext, getOptionValues(tsFlowOptions, untypedOptionValues));
    }
}
