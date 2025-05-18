import type { RenderContext } from "../../Renderer";
import {
    BooleanOption,
    StringOption,
    getOptionValues,
} from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import type { LanguageName, RendererOptions } from "../../types";

import { ElixirRenderer } from "./ElixirRenderer";

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
