import { mapMap } from "collection-utils";

import { TypeGraph } from "./TypeGraph";
import { Renderer, RenderContext } from "./Renderer";
import { OptionDefinition, Option } from "./RendererOptions";
import { serializeRenderResult, SerializedRenderResult } from "./Source";
import { StringTypeMapping } from "./TypeBuilder";
import { defined } from "./support/Support";
import { ConvenienceRenderer } from "./ConvenienceRenderer";
import { Type } from "./Type";
import { DateTimeRecognizer, DefaultDateTimeRecognizer } from "./DateTime";
import { type Comment } from "./support/Comments";

export type MultiFileRenderResult = ReadonlyMap<string, SerializedRenderResult>;

export type LanguageConfig = {
    readonly displayName: string;
    readonly names: readonly string[];
    readonly extension: string;
};

export abstract class TargetLanguage<Config extends LanguageConfig = LanguageConfig> {
    displayName: Config["displayName"];
    names: Config["names"];
    extension: Config["extension"];

    constructor({ displayName, names, extension }: Config) {
        this.displayName = displayName;
        this.names = names;
        this.extension = extension;
    }

    protected abstract getOptions(): Option<any>[];

    get optionDefinitions(): OptionDefinition[] {
        return this.getOptions().map(o => o.definition);
    }

    get cliOptionDefinitions(): { display: OptionDefinition[]; actual: OptionDefinition[] } {
        let actual: OptionDefinition[] = [];
        let display: OptionDefinition[] = [];
        for (const { cliDefinitions } of this.getOptions()) {
            actual = actual.concat(cliDefinitions.actual);
            display = display.concat(cliDefinitions.display);
        }
        return { actual, display };
    }

    get name(): (typeof this.names)[0] {
        return defined(this.names[0]);
    }

    protected abstract makeRenderer(renderContext: RenderContext, optionValues: { [name: string]: any }): Renderer;

    renderGraphAndSerialize(
        typeGraph: TypeGraph,
        givenOutputFilename: string,
        alphabetizeProperties: boolean,
        leadingComments: Comment[] | undefined,
        rendererOptions: { [name: string]: any },
        indentation?: string
    ): MultiFileRenderResult {
        if (indentation === undefined) {
            indentation = this.defaultIndentation;
        }
        const renderContext = { typeGraph, leadingComments };
        const renderer = this.makeRenderer(renderContext, rendererOptions);
        if ((renderer as any).setAlphabetizeProperties !== undefined) {
            (renderer as ConvenienceRenderer).setAlphabetizeProperties(alphabetizeProperties);
        }
        const renderResult = renderer.render(givenOutputFilename);
        return mapMap(renderResult.sources, s => serializeRenderResult(s, renderResult.names, defined(indentation)));
    }

    protected get defaultIndentation(): string {
        return "    ";
    }

    get stringTypeMapping(): StringTypeMapping {
        return new Map();
    }

    get supportsOptionalClassProperties(): boolean {
        return false;
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return false;
    }

    get supportsFullObjectType(): boolean {
        return false;
    }

    needsTransformerForType(_t: Type): boolean {
        return false;
    }

    get dateTimeRecognizer(): DateTimeRecognizer {
        return new DefaultDateTimeRecognizer();
    }
}
