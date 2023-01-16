import { EnumOption } from "../RendererOptions";

export enum ConvertersOptions {
    TopLevel = "top-level",
    AllObjects = "all-objects"
}

export function convertersOption() {
    return new EnumOption(
        "converters",
        "Which converters to generate (top-level by default)",
        [
            [ConvertersOptions.TopLevel, ConvertersOptions.TopLevel],
            [ConvertersOptions.AllObjects, ConvertersOptions.AllObjects]
        ],
        ConvertersOptions.TopLevel,
        "secondary"
    );
}
