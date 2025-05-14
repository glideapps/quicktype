import { EnumOption } from "../RendererOptions";

import {
    allLowerWordStyle,
    allUpperWordStyle,
    firstUpperWordStyle,
    originalWord,
} from "./Strings";

export enum AcronymStyleOptions {
    Camel = "camel",
    Lower = "lowerCase",
    Original = "original",
    Pascal = "pascal",
}

export const acronymOption = function (defaultOption: AcronymStyleOptions) {
    return new EnumOption(
        "acronym-style",
        "Acronym naming style",
        {
            [AcronymStyleOptions.Original]: AcronymStyleOptions.Original,
            [AcronymStyleOptions.Pascal]: AcronymStyleOptions.Pascal,
            [AcronymStyleOptions.Camel]: AcronymStyleOptions.Camel,
            [AcronymStyleOptions.Lower]: AcronymStyleOptions.Lower,
        } as const,
        defaultOption,
        "secondary",
    );
};

const options = {
    [AcronymStyleOptions.Pascal]: allUpperWordStyle,
    [AcronymStyleOptions.Camel]: firstUpperWordStyle,
    [AcronymStyleOptions.Original]: originalWord,
    [AcronymStyleOptions.Lower]: allLowerWordStyle,
} as const;

export function acronymStyle<AcronymStyle extends AcronymStyleOptions>(
    style: AcronymStyle,
): (typeof options)[AcronymStyle] {
    return options[style];
}
