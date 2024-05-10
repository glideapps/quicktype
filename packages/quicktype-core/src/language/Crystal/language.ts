import { type RenderContext } from "../../Renderer";
import { type Option } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType } from "../../types";

import { CrystalRenderer } from "./CrystalRenderer";

export const crystalLanguageConfig = {
    displayName: "Crystal",
    names: ["crystal", "cr", "crystallang"],
    extension: "cr"
} as const;

export class CrystalTargetLanguage extends TargetLanguage<typeof crystalLanguageConfig> {
    constructor() {
        super(crystalLanguageConfig);
    }

    protected makeRenderer(renderContext: RenderContext): CrystalRenderer {
        return new CrystalRenderer(this, renderContext);
    }

    protected get defaultIndentation(): string {
        return "  ";
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [];
    }
}
