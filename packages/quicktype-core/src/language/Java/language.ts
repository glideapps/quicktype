import type { RenderContext } from "../../Renderer";
import {
    BooleanOption,
    EnumOption,
    StringOption,
    getOptionValues,
} from "../../RendererOptions";
import { AcronymStyleOptions, acronymOption } from "../../support/Acronyms";
import { TargetLanguage } from "../../TargetLanguage";
import type {
    PrimitiveStringTypeKind,
    TransformedStringTypeKind,
} from "../../Type";
import type { StringTypeMapping } from "../../Type/TypeBuilderUtils";
import type { LanguageName, RendererOptions } from "../../types";

import { JacksonRenderer } from "./JavaJacksonRenderer";
import { JavaRenderer } from "./JavaRenderer";

export const javaOptions = {
    useList: new EnumOption(
        "array-type",
        "Use T[] or List<T>",
        { array: false, list: true } as const,
        "array",
    ),
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    dateTimeProvider: new EnumOption(
        "datetime-provider",
        "Date time provider type",
        { java8: "java8", legacy: "legacy" } as const,
        "java8",
    ),
    acronymStyle: acronymOption(AcronymStyleOptions.Pascal),
    // FIXME: Do this via a configurable named eventually.
    packageName: new StringOption(
        "package",
        "Generated package name",
        "NAME",
        "io.quicktype",
    ),
    lombok: new BooleanOption("lombok", "Use lombok", false, "primary"),
    lombokCopyAnnotations: new BooleanOption(
        "lombok-copy-annotations",
        "Copy accessor annotations",
        true,
        "secondary",
    ),
};

export const javaLanguageConfig = {
    displayName: "Java",
    names: ["java"],
    extension: "java",
} as const;

export class JavaTargetLanguage extends TargetLanguage<
    typeof javaLanguageConfig
> {
    public constructor() {
        super(javaLanguageConfig);
    }

    public getOptions(): typeof javaOptions {
        return javaOptions;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer<Lang extends LanguageName = "java">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): JavaRenderer {
        const options = getOptionValues(javaOptions, untypedOptionValues);
        if (options.justTypes) {
            return new JavaRenderer(this, renderContext, options);
        }

        return new JacksonRenderer(this, renderContext, options);
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> =
            new Map();
        mapping.set("date", "date");
        mapping.set("time", "time");
        mapping.set("date-time", "date-time");
        mapping.set("uuid", "uuid");
        return mapping;
    }
}
