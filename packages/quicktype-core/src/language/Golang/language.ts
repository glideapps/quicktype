import { type RenderContext } from "../../Renderer";
import { BooleanOption, StringOption, getOptionValues } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type PrimitiveStringTypeKind, type TransformedStringTypeKind } from "../../Type";
import { type StringTypeMapping } from "../../Type/TypeBuilderUtils";
import { type FixMeOptionsType } from "../../types";

import { GoRenderer } from "./GolangRenderer";

export const goOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    justTypesAndPackage: new BooleanOption("just-types-and-package", "Plain types with package only", false),
    packageName: new StringOption("package", "Generated package name", "NAME", "main"),
    multiFileOutput: new BooleanOption("multi-file-output", "Renders each top-level object in its own Go file", false),
    fieldTags: new StringOption("field-tags", "list of tags which should be generated for fields", "TAGS", "json"),
    omitEmpty: new BooleanOption(
        "omit-empty",
        'If set, all non-required objects will be tagged with ",omitempty"',
        false
    )
};

const golangLanguageConfig = {
    displayName: "Go",
    names: ["go", "golang"],
    extension: "go"
} as const;

export class GoTargetLanguage extends TargetLanguage<typeof golangLanguageConfig> {
    public constructor() {
        super(golangLanguageConfig);
    }

    public getOptions(): typeof goOptions {
        return goOptions;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> = new Map();
        mapping.set("date-time", "date-time");
        return mapping;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): GoRenderer {
        return new GoRenderer(this, renderContext, getOptionValues(goOptions, untypedOptionValues));
    }

    protected get defaultIndentation(): string {
        return "\t";
    }
}
