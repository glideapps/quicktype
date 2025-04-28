import { type RenderContext } from "../../Renderer";
import { BooleanOption, EnumOption, type Option, StringOption, getOptionValues } from "../../RendererOptions";
import { AcronymStyleOptions, acronymOption } from "../../support/Acronyms";
import { convertersOption } from "../../support/Converters";
import { TargetLanguage } from "../../TargetLanguage";
import { type PrimitiveStringTypeKind, type TransformedStringTypeKind } from "../../Type";
import { type StringTypeMapping } from "../../TypeBuilder";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { JavaScriptRenderer } from "./JavaScriptRenderer";

export const javaScriptOptions = {
    acronymStyle: acronymOption(AcronymStyleOptions.Pascal),
    runtimeTypecheck: new BooleanOption("runtime-typecheck", "Verify JSON.parse results at runtime", true),
    runtimeTypecheckIgnoreUnknownProperties: new BooleanOption(
        "runtime-typecheck-ignore-unknown-properties",
        "Ignore unknown properties when verifying at runtime",
        false,
        "secondary"
    ),
    converters: convertersOption(),
    rawType: new EnumOption<"json" | "any">(
        "raw-type",
        "Type of raw input (json by default)",
        [
            ["json", "json"],
            ["any", "any"]
        ],
        "json",
        "secondary"
    ),
    jsonStringifySpaceNum: new StringOption("json-stringify-space-size", "JSON.stringify space size", "4", "secondary"),
};

export class JavaScriptTargetLanguage extends TargetLanguage {
    public constructor(displayName = "JavaScript", names: string[] = ["javascript", "js", "jsx"], extension = "js") {
        super(displayName, names, extension);
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [
            javaScriptOptions.runtimeTypecheck,
            javaScriptOptions.runtimeTypecheckIgnoreUnknownProperties,
            javaScriptOptions.acronymStyle,
            javaScriptOptions.converters,
            javaScriptOptions.rawType
        ];
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> = new Map();
        const dateTimeType = "date-time";
        mapping.set("date", dateTimeType);
        mapping.set("date-time", dateTimeType);
        return mapping;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsFullObjectType(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): JavaScriptRenderer {
        return new JavaScriptRenderer(this, renderContext, getOptionValues(javaScriptOptions, untypedOptionValues));
    }
}
