import { type RenderContext } from "../../Renderer";
import { BooleanOption, type Option, StringOption, getOptionValues } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { ElixirRenderer } from "./ElixirRenderer";

export const elixirOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    namespace: new StringOption("namespace", "Specify a module namespace", "NAME", "")
};

export class ElixirTargetLanguage extends TargetLanguage {
    public constructor() {
        super("Elixir", ["elixir"], "ex");
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [elixirOptions.justTypes, elixirOptions.namespace];
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected get defaultIndentation(): string {
        return "  ";
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): ElixirRenderer {
        return new ElixirRenderer(this, renderContext, getOptionValues(elixirOptions, untypedOptionValues));
    }
}
