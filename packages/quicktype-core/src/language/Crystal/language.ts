import { type RenderContext } from "../../Renderer";
import { type Option } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType } from "../../types";

import { CrystalRenderer } from "./CrystalRenderer";

export class CrystalTargetLanguage extends TargetLanguage {
    protected makeRenderer(renderContext: RenderContext): CrystalRenderer {
        return new CrystalRenderer(this, renderContext);
    }

    public constructor() {
        super("Crystal", ["crystal", "cr", "crystallang"], "cr");
    }

    protected get defaultIndentation(): string {
        return "  ";
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [];
    }
}
