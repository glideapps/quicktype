import type { RenderContext } from "../../Renderer.js";
import {
    BooleanOption,
    EnumOption,
    getOptionValues,
} from "../../RendererOptions/index.js";
import {
    INT32_RANGE,
    INT64_RANGE,
    type IntegerRange,
} from "../../support/IntegerRange.js";
import { TargetLanguage } from "../../TargetLanguage.js";
import type { LanguageName, RendererOptions } from "../../types.js";

import { RustRenderer } from "./RustRenderer.js";
import { Density, Visibility } from "./utils.js";

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
        "public",
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
    deriveDebug: new BooleanOption("derive-debug", "Derive Debug impl", true),
    deriveClone: new BooleanOption("derive-clone", "Derive Clone impl", true),
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

    /**
     * The range of whole numbers the generated integer type can
     * represent.  With `integer-type: force-i32` every integer renders
     * as `i32`, so whole numbers in input JSON outside the i32 range
     * must be inferred as `double`.  `conservative` only narrows to
     * `i32` when schema bounds prove it fits, so it keeps the i64
     * range.
     */
    public getSupportedIntegerRange(
        rendererOptions: Record<string, unknown> = {},
    ): IntegerRange | null {
        if (
            rustOptions.integerType.getValue(rendererOptions) ===
            IntegerType.ForceI32
        ) {
            return INT32_RANGE;
        }

        return INT64_RANGE;
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
