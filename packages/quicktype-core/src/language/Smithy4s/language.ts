import { type ConvenienceRenderer } from "../../ConvenienceRenderer";
import { type RenderContext } from "../../Renderer";
import { EnumOption, type Option, StringOption, getOptionValues } from "../../RendererOptions";
import { assertNever } from "../../support/Support";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { Smithy4sRenderer } from "./Smithy4sRenderer";

export enum Framework {
    None = "None"
}

export const smithyOptions = {
    framework: new EnumOption("framework", "Serialization framework", [["just-types", Framework.None]], undefined),
    packageName: new StringOption("package", "Package", "PACKAGE", "quicktype")
};

export class SmithyTargetLanguage extends TargetLanguage {
    public constructor() {
        super("Smithy", ["Smithy"], "smithy");
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [smithyOptions.framework, smithyOptions.packageName];
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): ConvenienceRenderer {
        const options = getOptionValues(smithyOptions, untypedOptionValues);

        switch (options.framework) {
            case Framework.None:
                return new Smithy4sRenderer(this, renderContext, options);
            default:
                return assertNever(options.framework);
        }
    }
}
