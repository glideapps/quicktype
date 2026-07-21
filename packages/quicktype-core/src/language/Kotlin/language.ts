import type { ConvenienceRenderer } from "../../ConvenienceRenderer.js";
import type { DateTimeRecognizer } from "../../DateTime.js";
import type { RenderContext } from "../../Renderer.js";
import {
    BooleanOption,
    EnumOption,
    StringOption,
    getOptionValues,
} from "../../RendererOptions/index.js";
import { AcronymStyleOptions, acronymOption } from "../../support/Acronyms.js";
import { assertNever } from "../../support/Support.js";
import { TargetLanguage } from "../../TargetLanguage.js";
import type {
    PrimitiveStringTypeKind,
    TransformedStringTypeKind,
} from "../../Type/index.js";
import type { StringTypeMapping } from "../../Type/TypeBuilderUtils.js";
import type { LanguageName, RendererOptions } from "../../types.js";

import { KotlinJacksonRenderer } from "./KotlinJacksonRenderer.js";
import { KotlinKlaxonRenderer } from "./KotlinKlaxonRenderer.js";
import { KotlinRenderer } from "./KotlinRenderer.js";
import { KotlinXRenderer } from "./KotlinXRenderer.js";
import { KotlinDateTimeRecognizer } from "./utils.js";

export const kotlinOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    framework: new EnumOption(
        "framework",
        "Serialization framework",
        {
            jackson: "Jackson",
            klaxon: "Klaxon",
            kotlinx: "KotlinX",
        } as const,
        "jackson",
    ),
    acronymStyle: acronymOption(AcronymStyleOptions.Pascal),
    packageName: new StringOption("package", "Package", "PACKAGE", "quicktype"),
};

export const kotlinLanguageConfig = {
    displayName: "Kotlin",
    names: ["kotlin"],
    extension: "kt",
} as const;

export class KotlinTargetLanguage extends TargetLanguage<
    typeof kotlinLanguageConfig
> {
    public constructor() {
        super(kotlinLanguageConfig);
    }

    public getOptions(): typeof kotlinOptions {
        return kotlinOptions;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> =
            new Map();
        mapping.set("date", "date");
        mapping.set("time", "time");
        mapping.set("date-time", "date-time");
        return mapping;
    }

    // Only infer date/time types from JSON strings that java.time's ISO
    // formatters round-trip byte-identically; see KotlinDateTimeRecognizer.
    public get dateTimeRecognizer(): DateTimeRecognizer {
        return new KotlinDateTimeRecognizer();
    }

    protected makeRenderer<Lang extends LanguageName = "kotlin">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): ConvenienceRenderer {
        const options = getOptionValues(kotlinOptions, untypedOptionValues);

        // `--just-types` wins over whatever `--framework` says.
        if (options.justTypes) {
            return new KotlinRenderer(this, renderContext, options);
        }

        switch (options.framework) {
            case "Jackson":
                return new KotlinJacksonRenderer(this, renderContext, options);
            case "Klaxon":
                return new KotlinKlaxonRenderer(this, renderContext, options);
            case "KotlinX":
                return new KotlinXRenderer(this, renderContext, options);
            default:
                return assertNever(options.framework);
        }
    }
}
