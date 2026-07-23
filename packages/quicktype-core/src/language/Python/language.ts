import { iterableSome } from "collection-utils";

import type { RenderContext } from "../../Renderer.js";
import {
    BooleanOption,
    EnumOption,
    getOptionValues,
} from "../../RendererOptions/index.js";
import type { IntegerRange } from "../../support/IntegerRange.js";
import { TargetLanguage } from "../../TargetLanguage.js";
import type { StringTypeMapping } from "../../Type/TypeBuilderUtils.js";
import {
    type PrimitiveStringTypeKind,
    type TransformedStringTypeKind,
    type Type,
    UnionType,
} from "../../Type/index.js";
import type { LanguageName, RendererOptions } from "../../types.js";

import { JSONPythonRenderer } from "./JSONPythonRenderer.js";
import { PythonRenderer } from "./PythonRenderer.js";

export interface PythonFeatures {
    /** PEP 585 builtin generics (`list[str]`, `dict[str, int]`), Python 3.9+ */
    builtinGenerics: boolean;
    dataClasses: boolean;
    typeHints: boolean;
    /** `typing.Type`, unavailable in Python 3.6.0 */
    typingType: boolean;
    /** PEP 604 union operators (`str | None`), Python 3.10+ */
    unionOperators: boolean;
}

export const pythonOptions = {
    features: new EnumOption(
        "python-version",
        "Python version",
        {
            "3.5": {
                typeHints: false,
                typingType: false,
                dataClasses: false,
                builtinGenerics: false,
                unionOperators: false,
            },
            "3.6": {
                typeHints: true,
                typingType: false,
                dataClasses: false,
                builtinGenerics: false,
                unionOperators: false,
            },
            "3.7": {
                typeHints: true,
                typingType: true,
                dataClasses: true,
                builtinGenerics: false,
                unionOperators: false,
            },
            "3.9": {
                typeHints: true,
                typingType: true,
                dataClasses: true,
                builtinGenerics: true,
                unionOperators: false,
            },
            "3.10": {
                typeHints: true,
                typingType: true,
                dataClasses: true,
                builtinGenerics: true,
                unionOperators: true,
            },
        } satisfies Record<string, PythonFeatures>,
        "3.10",
    ),
    justTypes: new BooleanOption("just-types", "Classes only", false),
    nicePropertyNames: new BooleanOption(
        "nice-property-names",
        "Transform property names to be Pythonic",
        true,
    ),
    pydanticBaseModel: new BooleanOption(
        "pydantic-base-model",
        "Uses pydantic BaseModel",
        false,
    ),
};

export const pythonLanguageConfig = {
    displayName: "Python",
    names: ["python", "py"],
    extension: "py",
} as const;

export class PythonTargetLanguage extends TargetLanguage<
    typeof pythonLanguageConfig
> {
    // Python's integers are arbitrary-precision.
    public getSupportedIntegerRange(): IntegerRange | null {
        return null;
    }

    public constructor() {
        super(pythonLanguageConfig);
    }

    public getOptions(): typeof pythonOptions {
        return pythonOptions;
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> =
            new Map();
        mapping.set("date", "date");
        mapping.set("time", "time");
        mapping.set("date-time", "date-time");
        mapping.set("uuid", "uuid");
        mapping.set("integer-string", "integer-string");
        mapping.set("bool-string", "bool-string");
        return mapping;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    public get supportsOptionalClassProperties(): boolean {
        return false;
    }

    public needsTransformerForType(t: Type): boolean {
        if (t instanceof UnionType) {
            return iterableSome(t.members, (m) =>
                this.needsTransformerForType(m),
            );
        }

        return t.kind === "integer-string" || t.kind === "bool-string";
    }

    protected makeRenderer<Lang extends LanguageName = "python">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): PythonRenderer {
        const options = getOptionValues(pythonOptions, untypedOptionValues);
        if (options.justTypes) {
            return new PythonRenderer(this, renderContext, options);
        }

        return new JSONPythonRenderer(this, renderContext, options);
    }
}
