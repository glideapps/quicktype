import type { RenderContext } from "../../Renderer.js";
import {
    BooleanOption,
    StringOption,
    getOptionValues,
} from "../../RendererOptions/index.js";
import type { IntegerRange } from "../../support/IntegerRange.js";
import { TargetLanguage } from "../../TargetLanguage.js";
import type { LanguageName, RendererOptions } from "../../types.js";

import { ElixirRenderer } from "./ElixirRenderer.js";

export const elixirOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    namespace: new StringOption(
        "namespace",
        "Specify a module namespace",
        "NAME",
        "",
    ),
};

export const elixirLanguageConfig = {
    displayName: "Elixir",
    names: ["elixir"],
    extension: "ex",
} as const;

export class ElixirTargetLanguage extends TargetLanguage<
    typeof elixirLanguageConfig
> {
    // Elixir's integers are arbitrary-precision.
    public getSupportedIntegerRange(): IntegerRange | null {
        return null;
    }

    public constructor() {
        super(elixirLanguageConfig);
    }

    public getOptions(): typeof elixirOptions {
        return elixirOptions;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected get defaultIndentation(): string {
        return "  ";
    }

    protected makeRenderer<Lang extends LanguageName = "elixir">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): ElixirRenderer {
        return new ElixirRenderer(
            this,
            renderContext,
            getOptionValues(elixirOptions, untypedOptionValues),
        );
    }
}
