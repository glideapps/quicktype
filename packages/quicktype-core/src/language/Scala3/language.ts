import { type ConvenienceRenderer } from "../../ConvenienceRenderer";
import { type RenderContext } from "../../Renderer";
import { EnumOption, type Option, StringOption, getOptionValues } from "../../RendererOptions";
import { assertNever } from "../../support/Support";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { CirceRenderer } from "./CirceRenderer";
import { Scala3Renderer } from "./Scala3Renderer";
import { UpickleRenderer } from "./UpickleRenderer";

export enum Framework {
    None = "None",
    Upickle = "Upickle",
    Circe = "Circe"
}

export const scala3Options = {
    framework: new EnumOption(
        "framework",
        "Serialization framework",
        [
            ["just-types", Framework.None],
            ["circe", Framework.Circe],
            ["upickle", Framework.Upickle]
        ],
        undefined
    ),
    packageName: new StringOption("package", "Package", "PACKAGE", "quicktype")
};

export const scala3LanguageConfig = {
    displayName: "Scala3",
    names: ["scala3"],
    extension: "scala"
} as const;

export class Scala3TargetLanguage extends TargetLanguage<typeof scala3LanguageConfig> {
    constructor() {
        super(scala3LanguageConfig);
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [scala3Options.framework, scala3Options.packageName];
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): ConvenienceRenderer {
        const options = getOptionValues(scala3Options, untypedOptionValues);

        switch (options.framework) {
            case Framework.None:
                return new Scala3Renderer(this, renderContext, options);
            case Framework.Upickle:
                return new UpickleRenderer(this, renderContext, options);
            case Framework.Circe:
                return new CirceRenderer(this, renderContext, options);
            default:
                return assertNever(options.framework);
        }
    }
}
