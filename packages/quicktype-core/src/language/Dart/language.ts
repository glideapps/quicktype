import { type RenderContext } from "../../Renderer";
import {
    BooleanOption,
    StringOption,
    getOptionValues,
} from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import {
    type PrimitiveStringTypeKind,
    type TransformedStringTypeKind,
} from "../../Type";
import { type StringTypeMapping } from "../../Type/TypeBuilderUtils";
import { type FixMeOptionsType } from "../../types";

import { DartRenderer } from "./DartRenderer";

export const dartOptions = {
    nullSafety: new BooleanOption("null-safety", "Null Safety", true),
    justTypes: new BooleanOption("just-types", "Types only", false),
    codersInClass: new BooleanOption(
        "coders-in-class",
        "Put encoder & decoder in Class",
        false,
    ),
    methodNamesWithMap: new BooleanOption(
        "from-map",
        "Use method names fromMap() & toMap()",
        false,
        "secondary",
    ),
    requiredProperties: new BooleanOption(
        "required-props",
        "Make all properties required",
        false,
    ),
    finalProperties: new BooleanOption(
        "final-props",
        "Make all properties final",
        false,
    ),
    generateCopyWith: new BooleanOption(
        "copy-with",
        "Generate CopyWith method",
        false,
    ),
    useFreezed: new BooleanOption(
        "use-freezed",
        "Generate class definitions with @freezed compatibility",
        false,
        "secondary",
    ),
    useHive: new BooleanOption(
        "use-hive",
        "Generate annotations for Hive type adapters",
        false,
        "secondary",
    ),
    useJsonAnnotation: new BooleanOption(
        "use-json-annotation",
        "Generate annotations for json_serializable",
        false,
        "secondary",
    ),
    partName: new StringOption(
        "part-name",
        "Use this name in `part` directive",
        "NAME",
        "",
        "secondary",
    ),
};

export const dartLanguageConfig = {
    displayName: "Dart",
    names: ["dart"],
    extension: "dart",
} as const;

export class DartTargetLanguage extends TargetLanguage<
    typeof dartLanguageConfig
> {
    public constructor() {
        super(dartLanguageConfig);
    }

    public getOptions(): typeof dartOptions {
        return dartOptions;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> =
            new Map();
        mapping.set("date", "date");
        mapping.set("date-time", "date-time");
        return mapping;
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: FixMeOptionsType,
    ): DartRenderer {
        const options = getOptionValues(dartOptions, untypedOptionValues);
        return new DartRenderer(this, renderContext, options);
    }
}
