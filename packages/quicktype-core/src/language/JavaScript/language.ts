import type { RenderContext } from "../../Renderer";
import {
    BooleanOption,
    EnumOption,
    getOptionValues,
} from "../../RendererOptions";
import { AcronymStyleOptions, acronymOption } from "../../support/Acronyms";
import { convertersOption } from "../../support/Converters";
import { TargetLanguage } from "../../TargetLanguage";
import type {
    PrimitiveStringTypeKind,
    TransformedStringTypeKind,
} from "../../Type";
import type { StringTypeMapping } from "../../Type/TypeBuilderUtils";
import type { LanguageName, RendererOptions } from "../../types";

import { JavaScriptRenderer } from "./JavaScriptRenderer";

export const javaScriptOptions = {
    acronymStyle: acronymOption(AcronymStyleOptions.Pascal),
    runtimeTypecheck: new BooleanOption(
        "runtime-typecheck",
        "Verify JSON.parse results at runtime",
        true,
    ),
    runtimeTypecheckIgnoreUnknownProperties: new BooleanOption(
        "runtime-typecheck-ignore-unknown-properties",
        "Ignore unknown properties when verifying at runtime",
        false,
        "secondary",
    ),
    converters: convertersOption(),
    rawType: new EnumOption(
        "raw-type",
        "Type of raw input (json by default)",
        {
            json: "json",
            any: "any",
        } as const,
        "json",
        "secondary",
    ),
};

export const javaScriptLanguageConfig = {
    displayName: "JavaScript",
    names: ["javascript", "js", "jsx"],
    extension: "js",
} as const;

export class JavaScriptTargetLanguage extends TargetLanguage<
    typeof javaScriptLanguageConfig
> {
    public constructor() {
        super(javaScriptLanguageConfig);
    }

    public getOptions(): typeof javaScriptOptions {
        return javaScriptOptions;
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> =
            new Map();
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

    protected makeRenderer<Lang extends LanguageName = "javascript">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): JavaScriptRenderer {
        return new JavaScriptRenderer(
            this,
            renderContext,
            getOptionValues(javaScriptOptions, untypedOptionValues),
        );
    }
}
