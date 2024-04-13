import { type RenderContext } from "../../Renderer";
import { BooleanOption, EnumOption, type Option, StringOption, getOptionValues } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { RubyRenderer } from "./RubyRenderer";

export enum Strictness {
    Strict = "Strict::",
    Coercible = "Coercible::",
    None = "Types::"
}

export const rubyOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    strictness: new EnumOption("strictness", "Type strictness", [
        ["strict", Strictness.Strict],
        ["coercible", Strictness.Coercible],
        ["none", Strictness.None]
    ]),
    namespace: new StringOption("namespace", "Specify a wrapping Namespace", "NAME", "", "secondary")
};

export class RubyTargetLanguage extends TargetLanguage {
    public constructor() {
        super("Ruby", ["ruby"], "rb");
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [rubyOptions.justTypes, rubyOptions.strictness, rubyOptions.namespace];
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected get defaultIndentation(): string {
        return "  ";
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): RubyRenderer {
        return new RubyRenderer(this, renderContext, getOptionValues(rubyOptions, untypedOptionValues));
    }
}
