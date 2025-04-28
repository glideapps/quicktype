import { type RenderContext } from "../../Renderer";
import { TargetLanguage } from "../../TargetLanguage";

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

    public getOptions(): {} {
        return {};
    }

    protected makeRenderer(renderContext: RenderContext): PikeRenderer {
        return new PikeRenderer(this, renderContext);
    }
}
