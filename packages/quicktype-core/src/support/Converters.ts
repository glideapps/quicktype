import { EnumOption } from "../RendererOptions";

export enum ConvertersOptions {
    AllObjects = "all-objects",
    TopLevel = "top-level",
}

export function convertersOption() {
    return new EnumOption(
        "converters",
        "Which converters to generate (top-level by default)",
        {
            [ConvertersOptions.TopLevel]: ConvertersOptions.TopLevel,
            [ConvertersOptions.AllObjects]: ConvertersOptions.AllObjects,
        } as const,
        ConvertersOptions.TopLevel,
        "secondary",
    );
}
