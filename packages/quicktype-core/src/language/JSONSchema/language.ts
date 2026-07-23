import type { RenderContext } from "../../Renderer.js";
import { BooleanOption, getOptionValues } from "../../RendererOptions/index.js";
import type { IntegerRange } from "../../support/IntegerRange.js";
import { TargetLanguage } from "../../TargetLanguage.js";
import {
    type StringTypeMapping,
    getNoStringTypeMapping,
} from "../../Type/TypeBuilderUtils.js";
import type { LanguageName, RendererOptions } from "../../types.js";

import { JSONSchemaRenderer } from "./JSONSchemaRenderer.js";

export const jsonSchemaOptions = {
    multiFileOutput: new BooleanOption(
        "multi-file-output",
        "Renders each top-level object in its own JSON schema file",
        false,
    ),
};

export const JSONSchemaLanguageConfig = {
    displayName: "JSON Schema",
    names: ["schema", "json-schema"],
    extension: "schema",
} as const;

export class JSONSchemaTargetLanguage extends TargetLanguage<
    typeof JSONSchemaLanguageConfig
> {
    // JSON Schema's `integer` type is unbounded.
    public getSupportedIntegerRange(): IntegerRange | null {
        return null;
    }

    public constructor() {
        super(JSONSchemaLanguageConfig);
    }

    public getOptions(): typeof jsonSchemaOptions {
        return jsonSchemaOptions;
    }

    public get stringTypeMapping(): StringTypeMapping {
        return getNoStringTypeMapping();
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsFullObjectType(): boolean {
        return true;
    }

    protected makeRenderer<Lang extends LanguageName = "json-schema">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): JSONSchemaRenderer {
        return new JSONSchemaRenderer(
            this,
            renderContext,
            getOptionValues(jsonSchemaOptions, untypedOptionValues),
        );
    }
}
