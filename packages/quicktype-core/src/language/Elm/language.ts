import { type RenderContext } from "../../Renderer";
import { BooleanOption, EnumOption, type Option, StringOption, getOptionValues } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { ElmRenderer } from "./ElmRenderer";

export const elmOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    useList: new EnumOption("array-type", "Use Array or List", [
        ["array", false],
        ["list", true]
    ]),
    // FIXME: Do this via a configurable named eventually.
    moduleName: new StringOption("module", "Generated module name", "NAME", "QuickType")
};

export class ElmTargetLanguage extends TargetLanguage {
    public constructor() {
        super("Elm", ["elm"], "elm");
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [elmOptions.justTypes, elmOptions.moduleName, elmOptions.useList];
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): ElmRenderer {
        return new ElmRenderer(this, renderContext, getOptionValues(elmOptions, untypedOptionValues));
    }
}
