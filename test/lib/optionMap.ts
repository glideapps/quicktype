import { RendererOptions } from "quicktype-core";
import { ComparisonArgs } from "../utils";
import { GoLanguage, Language } from "../languages";

type TestOptions = {
    cliOptions: RendererOptions;
    language: Language;
    comparisonArgs?: Partial<ComparisonArgs>;
};

const optionMap: Record<string, TestOptions> = {
    "test/inputs/json/misc/227e2.in.json": {
        cliOptions: {
            "omit-empty": true
        },
        language: GoLanguage,
        comparisonArgs: {
            strict: true
        }
    }
};

export default optionMap;
