import { type RenderContext } from "../../Renderer";
import { TargetLanguage } from "../../TargetLanguage";

import { CrystalRenderer } from "./CrystalRenderer";

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

    protected makeRenderer(renderContext: RenderContext): CrystalRenderer {
        return new CrystalRenderer(this, renderContext);
    }

    protected get defaultIndentation(): string {
        return "  ";
    }

    public getOptions(): {} {
        return {};
    }
}
