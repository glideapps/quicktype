import { type RenderContext } from "../../Renderer";
import { BooleanOption, EnumOption, type Option, getOptionValues } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { RustRenderer } from "./RustRenderer";

export enum Density {
    Normal = "Normal",
    Dense = "Dense"
}

export enum Visibility {
    Private = "Private",
    Crate = "Crate",
    Public = "Public"
}

export const rustOptions = {
    density: new EnumOption("density", "Density", [
        ["normal", Density.Normal],
        ["dense", Density.Dense]
    ]),
    visibility: new EnumOption("visibility", "Field visibility", [
        ["private", Visibility.Private],
        ["crate", Visibility.Crate],
        ["public", Visibility.Public]
    ]),
    deriveDebug: new BooleanOption("derive-debug", "Derive Debug impl", false),
    deriveClone: new BooleanOption("derive-clone", "Derive Clone impl", false),
    derivePartialEq: new BooleanOption("derive-partial-eq", "Derive PartialEq impl", false),
    skipSerializingNone: new BooleanOption("skip-serializing-none", "Skip serializing empty Option fields", false),
    edition2018: new BooleanOption("edition-2018", "Edition 2018", true),
    leadingComments: new BooleanOption("leading-comments", "Leading Comments", true)
};

export class RustTargetLanguage extends TargetLanguage {
    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): RustRenderer {
        return new RustRenderer(this, renderContext, getOptionValues(rustOptions, untypedOptionValues));
    }

    public constructor() {
        super("Rust", ["rust", "rs", "rustlang"], "rs");
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [
            rustOptions.density,
            rustOptions.visibility,
            rustOptions.deriveDebug,
            rustOptions.deriveClone,
            rustOptions.derivePartialEq,
            rustOptions.edition2018,
            rustOptions.leadingComments,
            rustOptions.skipSerializingNone
        ];
    }
}
