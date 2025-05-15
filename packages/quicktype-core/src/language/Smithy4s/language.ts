import type { ConvenienceRenderer } from "../../ConvenienceRenderer";
import type { RenderContext } from "../../Renderer";
import {
    EnumOption,
    StringOption,
    getOptionValues,
} from "../../RendererOptions";
import { assertNever } from "../../support/Support";
import { TargetLanguage } from "../../TargetLanguage";
import type { FixMeOptionsType } from "../../types";

import { Smithy4sRenderer } from "./Smithy4sRenderer";

export enum Framework {
    None = "None",
}

export const smithyOptions = {
    // FIXME: why does this exist
    framework: new EnumOption(
        "framework",
        "Serialization framework",
        { "just-types": Framework.None } as const,
        "just-types",
    ),
    packageName: new StringOption("package", "Package", "PACKAGE", "quicktype"),
};

export const smithyLanguageConfig = {
    displayName: "Smithy",
    names: ["smithy4a"],
    extension: "smithy",
} as const;

export class SmithyTargetLanguage extends TargetLanguage<
    typeof smithyLanguageConfig
> {
    public constructor() {
        super(smithyLanguageConfig);
    }

    public getOptions(): typeof smithyOptions {
        return smithyOptions;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: FixMeOptionsType,
    ): ConvenienceRenderer {
        const options = getOptionValues(smithyOptions, untypedOptionValues);

        switch (options.framework) {
            case Framework.None:
                return new Smithy4sRenderer(this, renderContext, options);
            default:
                return assertNever(options.framework);
        }
    }
}
