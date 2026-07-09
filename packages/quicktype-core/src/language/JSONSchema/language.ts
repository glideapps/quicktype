import type { RenderContext } from "../../Renderer";
import { BooleanOption, getOptionValues } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import {
    type StringTypeMapping,
    getNoStringTypeMapping,
} from "../../Type/TypeBuilderUtils";
import type { LanguageName, RendererOptions } from "../../types";

import { JSONSchemaRenderer } from "./JSONSchemaRenderer";

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
