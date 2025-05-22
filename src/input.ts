import type { Readable } from "readable-stream";

import {
    FetchingJSONSchemaStore,
    InputData,
    JSONInput,
    JSONSchemaInput,
    type TargetLanguage,
    assertNever,
    defined,
    isLanguageName,
    languageNamed,
} from "quicktype-core";
import { GraphQLInput } from "quicktype-graphql-input";

import { CompressedJSONFromStream } from "./CompressedJSONFromStream";
import type { TypeSource } from "./TypeSource";

export function jsonInputForTargetLanguage(
    _targetLanguage: string | TargetLanguage,
    languages?: TargetLanguage[],
    handleJSONRefs = false,
): JSONInput<Readable> {
    let targetLanguage: TargetLanguage;
    if (typeof _targetLanguage === "string") {
        const languageName = isLanguageName(_targetLanguage)
            ? _targetLanguage
            : "typescript";
        targetLanguage = defined(languageNamed(languageName, languages));
    } else {
        targetLanguage = _targetLanguage;
    }

    const compressedJSON = new CompressedJSONFromStream(
        targetLanguage.dateTimeRecognizer,
        handleJSONRefs,
    );
    return new JSONInput(compressedJSON);
}

export async function makeInputData(
    sources: TypeSource[],
    targetLanguage: TargetLanguage,
    additionalSchemaAddresses: readonly string[],
    handleJSONRefs: boolean,
    httpHeaders?: string[],
): Promise<InputData> {
    const inputData = new InputData();

    for (const source of sources) {
        switch (source.kind) {
            case "graphql":
                await inputData.addSource(
                    "graphql",
                    source,
                    () => new GraphQLInput(),
                );
                break;
            case "json":
                await inputData.addSource("json", source, () =>
                    jsonInputForTargetLanguage(
                        targetLanguage,
                        undefined,
                        handleJSONRefs,
                    ),
                );
                break;
            case "schema":
                await inputData.addSource(
                    "schema",
                    source,
                    () =>
                        new JSONSchemaInput(
                            new FetchingJSONSchemaStore(httpHeaders),
                            [],
                            additionalSchemaAddresses,
                        ),
                );
                break;
            default:
                return assertNever(source);
        }
    }

    return inputData;
}
