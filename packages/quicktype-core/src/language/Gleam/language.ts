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

    // On Erlang, `decode.int` and `decode.float` are disjoint, and the
    // union decoder keeps its double variant strict — no `int.to_float`
    // widening — when an integer variant is present, so neither numeric
    // variant can swallow the other's values.
    public get supportsUnionsWithBothNumberTypes(): boolean {
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
