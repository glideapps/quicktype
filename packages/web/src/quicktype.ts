import {
    SerializedRenderResult,
    InputData,
    JSONSchemaInput,
    JSONSchemaStore,
    JSONSchema,
    Input,
    jsonInputForTargetLanguage
} from "quicktype-core";

export enum SourceType {
    JSON = "JSON",
    Multiple = "Multiple JSON",
    Schema = "JSON Schema",
    Postman = "Postman v2.1"
}

export const sourceTypes = [SourceType.JSON, SourceType.Multiple, SourceType.Schema, SourceType.Postman];

export interface RenderError {
    message: string;
    errorMessageKind?: string;
}

export type Files = { [filename: string]: SerializedRenderResult };

export interface AsyncSerializedRenderResult {
    result?: Files;
    error?: RenderError;
    receipt: number;
}

export interface Sample {
    name: string;
    source: string;
}

export interface Source {
    topLevelName: string;
    samples: Sample[];
    description?: string;
}

class BrowserSchemaStore extends JSONSchemaStore {
    async fetch(address: string): Promise<JSONSchema | undefined> {
        const fetched = await fetch(address);
        return fetched.json();
    }
}

export async function makeTypeSources(
    sourceType: SourceType,
    sources: Source[],
    targetLanguage: string
): Promise<InputData> {
    let input: Input<any>;
    switch (sourceType) {
        case SourceType.Schema:
            const schemaInput = new JSONSchemaInput(new BrowserSchemaStore());
            for (const s of sources) {
                await schemaInput.addSource({
                    name: s.topLevelName,
                    schema: s.samples[0].source
                });
            }
            input = schemaInput;
            break;
        default:
            const jsonInput = jsonInputForTargetLanguage(targetLanguage);
            for (const s of sources) {
                await jsonInput.addSource({
                    name: s.topLevelName,
                    samples: s.samples.map(x => x.source),
                    description: s.description
                });
            }
            input = jsonInput;
            break;
    }
    const inputData = new InputData();
    inputData.addInput(input);
    return inputData;
}
