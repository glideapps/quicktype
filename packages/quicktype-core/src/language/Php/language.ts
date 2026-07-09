import type { RenderContext } from "../../Renderer";
import { BooleanOption, getOptionValues } from "../../RendererOptions";
import { AcronymStyleOptions, acronymOption } from "../../support/Acronyms";
import { TargetLanguage } from "../../TargetLanguage";
import type {
    PrimitiveStringTypeKind,
    TransformedStringTypeKind,
} from "../../Type";
import type { StringTypeMapping } from "../../Type/TypeBuilderUtils";
import type { LanguageName, RendererOptions } from "../../types";

import { PhpRenderer } from "./PhpRenderer";

export const phpOptions = {
    withGet: new BooleanOption("with-get", "Create Getter", true),
    fastGet: new BooleanOption("fast-get", "getter without validation", false),
    withSet: new BooleanOption("with-set", "Create Setter", false),
    withClosing: new BooleanOption("with-closing", "PHP Closing Tag", false),
    acronymStyle: acronymOption(AcronymStyleOptions.Pascal),
};

export const phpLanguageConfig = {
    displayName: "PHP",
    names: ["php"],
    extension: "php",
} as const;

export class PhpTargetLanguage extends TargetLanguage<
    typeof phpLanguageConfig
> {
    public constructor() {
        super(phpLanguageConfig);
    }

    public getOptions(): typeof phpOptions {
        return phpOptions;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer<Lang extends LanguageName = "php">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): PhpRenderer {
        const options = getOptionValues(phpOptions, untypedOptionValues);
        return new PhpRenderer(this, renderContext, options);
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> =
            new Map();
        // "date" and "time" are not implemented in the renderer (it throws
        // on them), so let them fall back to plain strings.
        mapping.set("uuid", "uuid");
        mapping.set("date-time", "date-time");
        return mapping;
    }
}
