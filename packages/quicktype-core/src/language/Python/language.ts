import { iterableSome } from "collection-utils";

import { type RenderContext } from "../../Renderer";
import { BooleanOption, EnumOption, type Option, getOptionValues } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type PrimitiveStringTypeKind, type TransformedStringTypeKind, type Type, UnionType } from "../../Type";
import { type StringTypeMapping } from "../../TypeBuilder";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { JSONPythonRenderer } from "./JSONPythonRenderer";
import { PythonRenderer } from "./PythonRenderer";

export interface PythonFeatures {
    dataClasses: boolean;
    typeHints: boolean;
}

export const pythonOptions = {
    features: new EnumOption(
        "python-version",
        "Python version",
        {
            "3.5": { typeHints: false, dataClasses: false },
            "3.6": { typeHints: true, dataClasses: false },
            "3.7": { typeHints: true, dataClasses: true }
        },
        "3.6"
    ),
    justTypes: new BooleanOption("just-types", "Classes only", false),
    nicePropertyNames: new BooleanOption("nice-property-names", "Transform property names to be Pythonic", true)
};

export const pythonLanguageConfig = { displayName: "Python", names: ["python", "py"], extension: "py" } as const;

export class PythonTargetLanguage extends TargetLanguage<typeof pythonLanguageConfig> {
    public constructor() {
        super(pythonLanguageConfig);
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [pythonOptions.features, pythonOptions.justTypes, pythonOptions.nicePropertyNames];
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> = new Map();
        const dateTimeType = "date-time";
        mapping.set("date", dateTimeType);
        mapping.set("time", dateTimeType);
        mapping.set("date-time", dateTimeType);
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
            return iterableSome(t.members, m => this.needsTransformerForType(m));
        }

        return t.kind === "integer-string" || t.kind === "bool-string";
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): PythonRenderer {
        const options = getOptionValues(pythonOptions, untypedOptionValues);
        if (options.justTypes) {
            return new PythonRenderer(this, renderContext, options);
        } else {
            return new JSONPythonRenderer(this, renderContext, options);
        }
    }
}
