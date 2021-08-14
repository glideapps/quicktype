import { parse as JSON5parse } from "json5";
import { CompressedJSONFromString, JSONInput, TargetLanguage, languageNamed, defined } from "../quicktype-core";

export class CompressedJSON5FromString extends CompressedJSONFromString {
    parseSync(input: string): number {
        const json = JSON5parse(input);
        this.process(json);
        return this.finish();
    }
}

export class JSON5Input<T> extends JSONInput<T> {
    readonly kind: string = "json5";
}

export function json5InputForTargetLanguage(
    targetLanguage: string | TargetLanguage,
    languages?: TargetLanguage[],
    handleJSONRefs: boolean = false
): JSON5Input<string> {
    if (typeof targetLanguage === "string") {
        targetLanguage = defined(languageNamed(targetLanguage, languages));
    }
    const compressedJSON5 = new CompressedJSON5FromString(targetLanguage.dateTimeRecognizer, handleJSONRefs);
    return new JSON5Input(compressedJSON5);
}
