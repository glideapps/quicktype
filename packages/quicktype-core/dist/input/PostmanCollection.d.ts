import { JSONSourceData } from "./Inputs";
export declare function sourcesFromPostmanCollection(collectionJSON: string, collectionJSONAddress?: string): {
    sources: JSONSourceData<string>[];
    description: string | undefined;
};
