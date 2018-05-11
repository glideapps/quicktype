import { EnumOption, Option, StringOption } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { TypeGraph } from "../../TypeGraph";

import { KotlinRenderer } from "./KotlinRenderer";
import { KotlinKlaxonRenderer } from "./KotlinKlaxonRenderer";
import { KotlinMoshiRenderer } from "./KotlinMoshiRenderer";

export type KotlinRendererClass = new (
    targetLanguage: TargetLanguage,
    graph: TypeGraph,
    leadingComments: string[] | undefined,
    ...optionValues: any[]
) => KotlinRenderer;

export default class KotlinTargetLanguage extends TargetLanguage {
    private readonly _frameworkOption = new EnumOption<KotlinRendererClass>(
        "framework",
        "Serialization framework",
        [["just-types", KotlinRenderer], ["klaxon", KotlinKlaxonRenderer], ["moshi", KotlinMoshiRenderer]],
        "moshi"
    );

    private readonly _packageName = new StringOption("package", "Package", "PACKAGE", "quicktype");

    constructor() {
        super("Kotlin", ["kotlin"], "kt");
    }

    protected getOptions(): Option<any>[] {
        return [this._frameworkOption, this._packageName];
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected get rendererClass(): new (
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => KotlinRenderer {
        // This value is discarded when we override makeRenderer
        return KotlinRenderer;
    }

    protected makeRenderer(
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        rendererOptions: { [name: string]: any }
    ): KotlinRenderer {
        const rendererClass = this._frameworkOption.getValue(rendererOptions);
        return new rendererClass(
            this,
            graph,
            leadingComments,
            ...this.getOptions()
                .splice(1)
                .map(o => o.getValue(rendererOptions))
        );
    }
}
