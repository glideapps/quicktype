import { type RenderContext } from "../../Renderer";
import { BooleanOption, getOptionValues } from "../../RendererOptions";
import { AcronymStyleOptions, acronymOption } from "../../support/Acronyms";
import { TargetLanguage } from "../../TargetLanguage";
import {
    type PrimitiveStringTypeKind,
    type TransformedStringTypeKind,
} from "../../Type";
import { type StringTypeMapping } from "../../Type/TypeBuilderUtils";
import { type FixMeOptionsType } from "../../types";

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

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: FixMeOptionsType,
    ): PhpRenderer {
        const options = getOptionValues(phpOptions, untypedOptionValues);
        return new PhpRenderer(this, renderContext, options);
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> =
            new Map();
        mapping.set("date", "date"); // TODO is not implemented yet
        mapping.set("time", "time"); // TODO is not implemented yet
        mapping.set("uuid", "uuid"); // TODO is not implemented yet
        mapping.set("date-time", "date-time");
        return mapping;
    }
}
