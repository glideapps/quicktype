import type { ConvenienceRenderer } from "../../ConvenienceRenderer.js";
import type { RenderContext } from "../../Renderer.js";
import {
    BooleanOption,
    StringOption,
    getOptionValues,
} from "../../RendererOptions/index.js";
import { TargetLanguage } from "../../TargetLanguage.js";
import type { LanguageName, RendererOptions } from "../../types.js";

import { Smithy4sRenderer } from "./Smithy4sRenderer.js";

export const smithyOptions = {
    // Plain types is the only mode Smithy supports; the flag is accepted
    // for consistency with the other languages.
    justTypes: new BooleanOption("just-types", "Plain types only", false),
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

    protected makeRenderer<Lang extends LanguageName = "smithy4a">(
        renderContext: RenderContext,
        untypedOptionValues: RendererOptions<Lang>,
    ): ConvenienceRenderer {
        return new Smithy4sRenderer(
            this,
            renderContext,
            getOptionValues(smithyOptions, untypedOptionValues),
        );
    }
}
