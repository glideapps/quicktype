import type { ConvenienceRenderer } from "../../ConvenienceRenderer";
import type { RenderContext } from "../../Renderer";
import {
    EnumOption,
    StringOption,
    getOptionValues,
} from "../../RendererOptions";
import { assertNever } from "../../support/Support";
import { TargetLanguage } from "../../TargetLanguage";
import type { FixMeOptionsType } from "../../types";

import { CirceRenderer } from "./CirceRenderer";
import { Scala3Renderer } from "./Scala3Renderer";
import { UpickleRenderer } from "./UpickleRenderer";

export const scala3Options = {
    framework: new EnumOption(
        "framework",
        "Serialization framework",
        {
            "just-types": "None",
            circe: "Circe",
            upickle: "Upickle",
        } as const,
        "just-types",
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

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: FixMeOptionsType,
    ): ConvenienceRenderer {
        const options = getOptionValues(scala3Options, untypedOptionValues);

        switch (options.framework) {
            case "None":
                return new Scala3Renderer(this, renderContext, options);
            case "Upickle":
                return new UpickleRenderer(this, renderContext, options);
            case "Circe":
                return new CirceRenderer(this, renderContext, options);
            default:
                return assertNever(options.framework);
        }
    }
}
