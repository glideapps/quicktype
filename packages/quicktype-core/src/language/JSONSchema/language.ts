import { type RenderContext } from "../../Renderer";
import { type Option } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type StringTypeMapping, getNoStringTypeMapping } from "../../TypeBuilder";
import { type FixMeOptionsAnyType } from "../../types";

import { JSONSchemaRenderer } from "./JSONSchemaRenderer";

export class JSONSchemaTargetLanguage extends TargetLanguage {
    public constructor() {
        super("JSON Schema", ["schema", "json-schema"], "schema");
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
