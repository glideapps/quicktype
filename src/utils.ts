import * as path from "node:path";

import * as _ from "lodash";
import type { Readable } from "readable-stream";
import stringToStream from "string-to-stream";
import _wordwrap from "wordwrap";

import {
    assert,
    type InferenceFlagName,
    splitIntoWords,
    type JSONSourceData,
    type TargetLanguage,
} from "quicktype-core";

import type { NegatedInferenceFlagName } from "./CLIOptions.types";

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

export function negatedInferenceFlagName<Input extends InferenceFlagName>(
    inputName: Input,
): NegatedInferenceFlagName<Input> {
    const withoutLeadingInfer = inputName.replace(/^infer/, "");
    const asPascalCase = withoutLeadingInfer.replace(/^\w/, (x) =>
        x.toUpperCase(),
    );
    return `no${asPascalCase}` as NegatedInferenceFlagName<Input>;
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
