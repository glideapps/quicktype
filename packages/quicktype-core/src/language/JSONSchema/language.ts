import type { RenderContext } from "../../Renderer";
import { TargetLanguage } from "../../TargetLanguage";
import {
    type StringTypeMapping,
    getNoStringTypeMapping,
} from "../../Type/TypeBuilderUtils";
import type { FixMeOptionsType } from "../../types";

import { JSONSchemaRenderer } from "./JSONSchemaRenderer";

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

    public getOptions(): {} {
        return {};
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

    protected makeRenderer(
        renderContext: RenderContext,
        _untypedOptionValues: FixMeOptionsType,
    ): JSONSchemaRenderer {
        return new JSONSchemaRenderer(this, renderContext);
    }
}
