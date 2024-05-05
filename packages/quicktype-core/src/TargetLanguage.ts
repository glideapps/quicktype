import { mapMap } from "collection-utils";

import { ConvenienceRenderer } from "./ConvenienceRenderer";
import { type DateTimeRecognizer, DefaultDateTimeRecognizer } from "./DateTime";
import { type RenderContext, type Renderer } from "./Renderer";
import { type Option, type OptionDefinition } from "./RendererOptions";
import { type SerializedRenderResult, serializeRenderResult } from "./Source";
import { type Comment } from "./support/Comments";
import { defined } from "./support/Support";
import { type Type } from "./Type";
import { type StringTypeMapping } from "./TypeBuilder";
import { type TypeGraph } from "./TypeGraph";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "./types";

export type MultiFileRenderResult = ReadonlyMap<string, SerializedRenderResult>;

export abstract class TargetLanguage {
    public constructor(
        public readonly displayName: string,
        public readonly names: string[],
        public readonly extension: string
    ) {}

    protected abstract getOptions(): Array<Option<FixMeOptionsAnyType>>;

    public get optionDefinitions(): OptionDefinition[] {
        return this.getOptions().map(o => o.definition);
    }

    public get cliOptionDefinitions(): { actual: OptionDefinition[]; display: OptionDefinition[] } {
        let actual: OptionDefinition[] = [];
        let display: OptionDefinition[] = [];
        for (const { cliDefinitions } of this.getOptions()) {
            actual = actual.concat(cliDefinitions.actual);
            display = display.concat(cliDefinitions.display);
        }

        return { actual, display };
    }

    public get name(): string {
        return defined(this.names[0]);
    }

    protected abstract makeRenderer(renderContext: RenderContext, optionValues: FixMeOptionsType): Renderer;

    public renderGraphAndSerialize(
        typeGraph: TypeGraph,
        givenOutputFilename: string,
        alphabetizeProperties: boolean,
        leadingComments: Comment[] | undefined,
        rendererOptions: FixMeOptionsType,
        indentation?: string
    ): MultiFileRenderResult {
        if (indentation === undefined) {
            indentation = this.defaultIndentation;
        }

        const renderContext = { typeGraph, leadingComments };
        const renderer = this.makeRenderer(renderContext, rendererOptions);
        if (renderer instanceof ConvenienceRenderer) {
            renderer.setAlphabetizeProperties(alphabetizeProperties);
        }

        const renderResult = renderer.render(givenOutputFilename);
        return mapMap(renderResult.sources, s => serializeRenderResult(s, renderResult.names, defined(indentation)));
    }

    protected get defaultIndentation(): string {
        return "    ";
    }

    public get stringTypeMapping(): StringTypeMapping {
        return new Map();
    }

    public get supportsOptionalClassProperties(): boolean {
        return false;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return false;
    }

    public get supportsFullObjectType(): boolean {
        return false;
    }

    public needsTransformerForType(_t: Type): boolean {
        return false;
    }

    public get dateTimeRecognizer(): DateTimeRecognizer {
        return new DefaultDateTimeRecognizer();
    }
}
