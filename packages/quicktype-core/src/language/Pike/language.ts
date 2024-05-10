import { type RenderContext } from "../../Renderer";
import { type Option } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType } from "../../types";

import { PikeRenderer } from "./PikeRenderer";

export const pikeOptions = {};

export const pikeLanguageConfig = {
    displayName: "Pike",
    names: ["pike", "pikelang"],
    extension: "pmod"
} as const;

export class PikeTargetLanguage extends TargetLanguage<typeof pikeLanguageConfig> {
    public constructor() {
        super(pikeLanguageConfig);
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [];
    }

    protected makeRenderer(renderContext: RenderContext): PikeRenderer {
        return new PikeRenderer(this, renderContext);
    }
}
