import type { RenderContext } from "../../Renderer.js";
import { INT64_RANGE, type IntegerRange } from "../../support/IntegerRange.js";
import { TargetLanguage } from "../../TargetLanguage.js";

import { CrystalRenderer } from "./CrystalRenderer.js";

export const crystalLanguageConfig = {
    displayName: "Crystal",
    names: ["crystal", "cr", "crystallang"],
    extension: "cr",
} as const;

export class CrystalTargetLanguage extends TargetLanguage<
    typeof crystalLanguageConfig
> {
    public constructor() {
        super(crystalLanguageConfig);
    }

    // The Crystal renderer emits `Int64` for inferred integers.
    public getSupportedIntegerRange(): IntegerRange | null {
        return INT64_RANGE;
    }

    protected makeRenderer(renderContext: RenderContext): CrystalRenderer {
        return new CrystalRenderer(this, renderContext);
    }

    protected get defaultIndentation(): string {
        return "  ";
    }

    public getOptions(): Record<string, never> {
        return {};
    }
}
