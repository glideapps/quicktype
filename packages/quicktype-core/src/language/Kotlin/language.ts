import { type ConvenienceRenderer } from "../../ConvenienceRenderer";
import { type RenderContext } from "../../Renderer";
import { EnumOption, type Option, StringOption, getOptionValues } from "../../RendererOptions";
import { AcronymStyleOptions, acronymOption } from "../../support/Acronyms";
import { assertNever } from "../../support/Support";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { KotlinJacksonRenderer } from "./KotlinJacksonRenderer";
import { KotlinKlaxonRenderer } from "./KotlinKlaxonRenderer";
import { KotlinRenderer } from "./KotlinRenderer";
import { KotlinXRenderer } from "./KotlinXRenderer";

export enum Framework {
    None = "None",
    Jackson = "Jackson",
    Klaxon = "Klaxon",
    KotlinX = "KotlinX"
}

export const kotlinOptions = {
    framework: new EnumOption(
        "framework",
        "Serialization framework",
        [
            ["just-types", Framework.None],
            ["jackson", Framework.Jackson],
            ["klaxon", Framework.Klaxon],
            ["kotlinx", Framework.KotlinX]
        ],
        "klaxon"
    ),
    acronymStyle: acronymOption(AcronymStyleOptions.Pascal),
    packageName: new StringOption("package", "Package", "PACKAGE", "quicktype")
};

export const kotlinLanguageConfig = {
	displayName: "Kotlin",
	names: ["kotlin"],
	extension: "kt"
} as const;

export class KotlinTargetLanguage extends TargetLanguage<typeof kotlinLanguageConfig> {
	constructor() {
			super(kotlinLanguageConfig);
	}
    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [kotlinOptions.framework, kotlinOptions.acronymStyle, kotlinOptions.packageName];
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): ConvenienceRenderer {
        const options = getOptionValues(kotlinOptions, untypedOptionValues);

        switch (options.framework) {
            case Framework.None:
                return new KotlinRenderer(this, renderContext, options);
            case Framework.Jackson:
                return new KotlinJacksonRenderer(this, renderContext, options);
            case Framework.Klaxon:
                return new KotlinKlaxonRenderer(this, renderContext, options);
            case Framework.KotlinX:
                return new KotlinXRenderer(this, renderContext, options);
            default:
                return assertNever(options.framework);
        }
    }
}
