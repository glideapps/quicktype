import { type RenderContext } from "../../Renderer";
import { type Option } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType } from "../../types";

import { PikeRenderer } from "./PikeRenderer";

export const pikeOptions = {};

export class PikeTargetLanguage extends TargetLanguage {
    public constructor() {
        super("Pike", ["pike", "pikelang"], "pmod");
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [];
    }

    protected makeRenderer(renderContext: RenderContext): PikeRenderer {
        return new PikeRenderer(this, renderContext);
    }
}
