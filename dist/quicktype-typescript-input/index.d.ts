import { JSONSchemaSourceData } from "../quicktype-core";
export declare function schemaForTypeScriptSources(sourceFileNames: string[]): JSONSchemaSourceData;
export declare function schemaForTypeScriptSources(sources: {
    [fileName: string]: string;
}): JSONSchemaSourceData;
