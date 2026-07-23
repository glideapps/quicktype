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
import type {
    PrimitiveStringTypeKind,
    TransformedStringTypeKind,
    Type,
} from "../../Type/index.js";
import type { StringTypeMapping } from "../../Type/TypeBuilderUtils.js";
import type { LanguageName, RendererOptions } from "../../types.js";

import { NewtonsoftCSharpRenderer } from "./NewtonSoftCSharpRenderer.js";
import { SystemTextJsonCSharpRenderer } from "./SystemTextJsonCSharpRenderer.js";
import { needTransformerForType } from "./utils.js";

export interface OutputFeatures {
    attributes: boolean;
    helpers: boolean;
}

export type CSharpTypeForAny = "object" | "dynamic";

export const cSharpOptions = {
    framework: new EnumOption(
        "framework",
        "Serialization framework",
        {
            NewtonSoft: "NewtonSoft",
            SystemTextJson: "SystemTextJson",
        } as const,
        "SystemTextJson",
    ),
    useList: new EnumOption(
        "array-type",
        "Use T[] or List<T>",
        {
            array: false,
            list: true,
        },
        "array",
    ),
    dense: new EnumOption(
        "density",
        "Property density",
        {
            normal: false,
            dense: true,
        } as const,
        "normal",
        "secondary",
    ),
    // FIXME: Do this via a configurable named eventually.
    namespace: new StringOption(
        "namespace",
        "Generated namespace",
        "NAME",
        "QuickType",
    ),
    version: new EnumOption(
        "csharp-version",
        "C# version",
        {
            "5": 5,
            "6": 6,
            "8": 8,
        } as const,
        "8",
        "secondary",
    ),
    virtual: new BooleanOption("virtual", "Generate virtual properties", false),
    useRecords: new BooleanOption(
        "use-records",
        "Generate records instead of classes (C# 9+)",
        false,
    ),
    typeForAny: new EnumOption(
        "any-type",
        'Type to use for "any"',
        {
            object: "object",
            dynamic: "dynamic",
        } as const,
        "object",
        "secondary",
    ),
    useDecimal: new EnumOption(
        "number-type",
        "Type to use for numbers",
        {
            double: false,
            decimal: true,
        } as const,
        "double",
        "secondary",
    ),
    features: new EnumOption(
        "features",
        "Output features",
        {
            complete: { namespaces: true, helpers: true, attributes: true },
            "attributes-only": {
                namespaces: true,
                helpers: false,
                attributes: true,
            },
        } as const,
        "complete",
    ),
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    baseclass: new EnumOption(
        "base-class",
        "Base class",
        {
            EntityData: "EntityData",
            Object: undefined,
        } as const,
        "Object",
        "secondary",
    ),
    checkRequired: new BooleanOption(
        "check-required",
        "Fail if required properties are missing",
        false,
    ),
    keepPropertyName: new BooleanOption(
        "keep-property-name",
        "Keep original field name generate",
        false,
    ),
} as const;

export const newtonsoftCSharpOptions = { ...cSharpOptions };

export const systemTextJsonCSharpOptions = {
    ...cSharpOptions,
    dateTimeOnlyConverters: new BooleanOption(
        "dateonly-timeonly-converters",
        "Emit DateOnly/TimeOnly converters (requires .NET 6 or later)",
        true,
        "secondary",
    ),
};

export const cSharpLanguageConfig = {
    displayName: "C#",
    names: ["cs", "csharp"],
    extension: "cs",
} as const;

export class CSharpTargetLanguage extends TargetLanguage<
    typeof cSharpLanguageConfig
> {
    public constructor() {
        super(cSharpLanguageConfig);
    }

    public getOptions(): typeof systemTextJsonCSharpOptions {
        return systemTextJsonCSharpOptions;
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> =
            new Map();
        mapping.set("date", "date-time");
        mapping.set("time", "date-time");
        mapping.set("date-time", "date-time");
        mapping.set("uuid", "uuid");
        mapping.set("uri", "uri");
        mapping.set("integer-string", "integer-string");
        mapping.set("bool-string", "bool-string");
        return mapping;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public needsTransformerForType(t: Type): boolean {
        const need = needTransformerForType(t);
        return need !== "none" && need !== "nullable";
    }

    protected makeRenderer<Lang extends LanguageName = "csharp">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): ConvenienceRenderer {
        const options = getOptionValues(cSharpOptions, untypedOptionValues);

        switch (options.framework) {
            case "NewtonSoft":
                return new NewtonsoftCSharpRenderer(
                    this,
                    renderContext,
                    getOptionValues(
                        newtonsoftCSharpOptions,
                        untypedOptionValues,
                    ),
                );
            case "SystemTextJson":
                return new SystemTextJsonCSharpRenderer(
                    this,
                    renderContext,
                    getOptionValues(
                        systemTextJsonCSharpOptions,
                        untypedOptionValues,
                    ),
                );
            default:
                return assertNever(options.framework);
        }
    }
}
