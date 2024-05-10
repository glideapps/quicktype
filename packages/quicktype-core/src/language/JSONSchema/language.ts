import { type RenderContext } from "../../Renderer";
import { type Option } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type StringTypeMapping, getNoStringTypeMapping } from "../../TypeBuilder";
import { type FixMeOptionsType, type FixMeOptionsAnyType } from "../../types";

import { JSONSchemaRenderer } from "./JSONSchemaRenderer";

export const JSONSchemaLanguageConfig = {
    displayName: "JSON Schema",
    names: ["schema", "json-schema"],
    extension: "schema"
} as const;

export class JSONSchemaTargetLanguage extends TargetLanguage<typeof JSONSchemaLanguageConfig> {
    constructor() {
        super(JSONSchemaLanguageConfig);
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [];
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

    protected makeRenderer(renderContext: RenderContext, _untypedOptionValues: FixMeOptionsType): JSONSchemaRenderer {
        return new JSONSchemaRenderer(this, renderContext);
    }
}
