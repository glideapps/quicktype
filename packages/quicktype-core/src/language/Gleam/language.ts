import type { RenderContext } from "../../Renderer.js";
import type { IntegerRange } from "../../support/IntegerRange.js";
import { TargetLanguage } from "../../TargetLanguage.js";

import { GleamRenderer } from "./GleamRenderer.js";

export const gleamLanguageConfig = {
    displayName: "Gleam",
    names: ["gleam"],
    extension: "gleam",
} as const;

export class GleamTargetLanguage extends TargetLanguage<
    typeof gleamLanguageConfig
> {
    public constructor() {
        super(gleamLanguageConfig);
    }

    // Gleam's Int is an Erlang arbitrary-precision integer.
    public getSupportedIntegerRange(): IntegerRange | null {
        return null;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    // On Erlang, `decode.int` and `decode.float` are disjoint, so a
    // number union decodes both without the integer-before-number hazard
    // that bites renderers sharing one numeric decoder.
    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    // `Int` and `Float` are distinct types, so JSON samples that mix
    // `123` and `12.3` infer an `Int | Float` union rather than widening
    // every whole number to a `Float` that re-encodes as `123.0`.
    public get infersUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext): GleamRenderer {
        return new GleamRenderer(this, renderContext);
    }

    protected get defaultIndentation(): string {
        return "  ";
    }

    public getOptions(): Record<string, never> {
        return {};
    }
}
