import * as path from "node:path";

import * as _ from "lodash";
import type { Readable } from "readable-stream";
import stringToStream from "string-to-stream";
import _wordwrap from "wordwrap";

import {
    assert,
    splitIntoWords,
    type JSONSourceData,
    type TargetLanguage,
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

    return `no${_.capitalize(name)}`;
}

export function dashedFromCamelCase(name: string): string {
    return splitIntoWords(name)
        .map((w) => w.word.toLowerCase())
        .join("-");
}

export function typeNameFromFilename(filename: string): string {
    const name = path.basename(filename);
    return name.substring(0, name.lastIndexOf("."));
}

export function stringSourceDataToStreamSourceData(
    src: JSONSourceData<string>,
): JSONSourceData<Readable> {
    return {
        name: src.name,
        description: src.description,
        samples: src.samples.map(
            (sample) => stringToStream(sample) as Readable,
        ),
    };
}
