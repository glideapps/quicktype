import _ from "lodash";
import {
    type TargetLanguage,
    assert,
    capitalize,
    splitIntoWords,
} from "quicktype-core";

export function makeLangTypeLabel(
    targetLanguages: readonly TargetLanguage[],
): string {
    assert(
        targetLanguages.length > 0,
        "Must have at least one target language",
    );
    return targetLanguages
        .map((r) => _.minBy(r.names, (s) => s.length))
        .join("|");
}

export function negatedInferenceFlagName(inputName: string): string {
    let name = inputName;
    const prefix = "infer";
    if (name.startsWith(prefix)) {
        name = name.slice(prefix.length);
    }

    return `no${capitalize(name)}`;
}

export function dashedFromCamelCase(name: string): string {
    return splitIntoWords(name)
        .map((w) => w.word.toLowerCase())
        .join("-");
}
