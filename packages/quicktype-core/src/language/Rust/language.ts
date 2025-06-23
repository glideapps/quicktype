import type { RenderContext } from "../../Renderer";
import {
    BooleanOption,
    EnumOption,
    getOptionValues,
} from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import type { LanguageName, RendererOptions } from "../../types";

import { RustRenderer } from "./RustRenderer";
import { Density, Visibility } from "./utils";

export enum IntegerType {
    Conservative = "conservative",
    ForceI32 = "force-i32",
    ForceI64 = "force-i64",
}

export const rustOptions = {
    density: new EnumOption(
        "density",
        "Density",
        {
            normal: Density.Normal,
            dense: Density.Dense,
        } as const,
        "normal",
    ),
    visibility: new EnumOption(
        "visibility",
        "Field visibility",
        {
            private: Visibility.Private,
            crate: Visibility.Crate,
            public: Visibility.Public,
        } as const,
        "private",
    ),
    integerType: new EnumOption(
        "integer-type",
        "Integer type inference",
        {
            conservative: IntegerType.Conservative,
            "force-i32": IntegerType.ForceI32,
            "force-i64": IntegerType.ForceI64,
        } as const,
        "conservative",
    ),
    deriveDebug: new BooleanOption("derive-debug", "Derive Debug impl", false),
    deriveClone: new BooleanOption("derive-clone", "Derive Clone impl", false),
    derivePartialEq: new BooleanOption(
        "derive-partial-eq",
        "Derive PartialEq impl",
        false,
    ),
    skipSerializingNone: new BooleanOption(
        "skip-serializing-none",
        "Skip serializing empty Option fields",
        false,
    ),
    edition2018: new BooleanOption("edition-2018", "Edition 2018", true),
    leadingComments: new BooleanOption(
        "leading-comments",
        "Leading Comments",
        true,
    ),
} as const;

export const rustLanguageConfig = {
    displayName: "Rust",
    names: ["rust", "rs", "rustlang"],
    extension: "rs",
} as const;

export class RustTargetLanguage extends TargetLanguage<
    typeof rustLanguageConfig
> {
    public constructor() {
        super(rustLanguageConfig);
    }

    public getOptions(): typeof rustOptions {
        return rustOptions;
    }

    protected makeRenderer<Lang extends LanguageName = "rust">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): RustRenderer {
        return new RustRenderer(
            this,
            renderContext,
            getOptionValues(rustOptions, untypedOptionValues),
        );
    }
}
