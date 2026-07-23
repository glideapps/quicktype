import type { ConvenienceRenderer } from "../../ConvenienceRenderer.js";
import type { RenderContext } from "../../Renderer.js";
import {
    BooleanOption,
    EnumOption,
    StringOption,
    getOptionValues,
} from "../../RendererOptions/index.js";
import { assertNever } from "../../support/Support.js";
import { TargetLanguage } from "../../TargetLanguage.js";
import type { LanguageName, RendererOptions } from "../../types.js";

import { CirceRenderer } from "./CirceRenderer.js";
import { Scala3Renderer } from "./Scala3Renderer.js";
import { UpickleRenderer } from "./UpickleRenderer.js";

export const scala3Options = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    framework: new EnumOption(
        "framework",
        "Serialization framework",
        {
            circe: "Circe",
            upickle: "Upickle",
        } as const,
        "circe",
    ),
    packageName: new StringOption("package", "Package", "PACKAGE", "quicktype"),
};

export const scala3LanguageConfig = {
    displayName: "Scala3",
    names: ["scala3"],
    extension: "scala",
} as const;

export class Scala3TargetLanguage extends TargetLanguage<
    typeof scala3LanguageConfig
> {
    public constructor() {
        super(scala3LanguageConfig);
    }

    public getOptions(): typeof scala3Options {
        return scala3Options;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer<Lang extends LanguageName = "scala3">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): ConvenienceRenderer {
        const options = getOptionValues(scala3Options, untypedOptionValues);

        // `--just-types` wins over whatever `--framework` says.
        if (options.justTypes) {
            return new Scala3Renderer(this, renderContext, options);
        }

        switch (options.framework) {
            case "Upickle":
                return new UpickleRenderer(this, renderContext, options);
            case "Circe":
                return new CirceRenderer(this, renderContext, options);
            default:
                return assertNever(options.framework);
        }
    }
}
