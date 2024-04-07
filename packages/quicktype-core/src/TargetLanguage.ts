import { mapMap } from "collection-utils";

import { type TypeGraph } from "./TypeGraph";
import { type Renderer, type RenderContext } from "./Renderer";
import { type OptionDefinition, type Option } from "./RendererOptions";
import { type SerializedRenderResult } from "./Source";
import { serializeRenderResult } from "./Source";
import { type StringTypeMapping } from "./TypeBuilder";
import { defined } from "./support/Support";
import { type ConvenienceRenderer } from "./ConvenienceRenderer";
import { type Type } from "./Type";
import { type DateTimeRecognizer} from "./DateTime";
import { DefaultDateTimeRecognizer } from "./DateTime";
import { type Comment } from "./support/Comments";

export type MultiFileRenderResult = ReadonlyMap<string, SerializedRenderResult>;

export abstract class TargetLanguage {
    constructor (
        readonly displayName: string,
        readonly names: string[],
        readonly extension: string,
    ) {}

    protected abstract getOptions (): Array<Option<any>>;

    get optionDefinitions (): OptionDefinition[] {
        return this.getOptions().map(o => o.definition);
    }

    get cliOptionDefinitions (): { actual: OptionDefinition[], display: OptionDefinition[], } {
        let actual: OptionDefinition[] = [];
        let display: OptionDefinition[] = [];
        for (const { cliDefinitions } of this.getOptions()) {
            actual = actual.concat(cliDefinitions.actual);
            display = display.concat(cliDefinitions.display);
        }

        return { actual, display };
    }

    get name (): string {
        return defined(this.names[0]);
    }

    protected abstract makeRenderer (renderContext: RenderContext, optionValues: { [name: string]: any, }): Renderer;

    renderGraphAndSerialize (
        typeGraph: TypeGraph,
        givenOutputFilename: string,
        alphabetizeProperties: boolean,
        leadingComments: Comment[] | undefined,
        rendererOptions: { [name: string]: any, },
        indentation?: string,
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

    protected get defaultIndentation (): string {
        return "    ";
    }

    get stringTypeMapping (): StringTypeMapping {
        return new Map();
    }

    get supportsOptionalClassProperties (): boolean {
        return false;
    }

    get supportsUnionsWithBothNumberTypes (): boolean {
        return false;
    }

    get supportsFullObjectType (): boolean {
        return false;
    }

    needsTransformerForType (_t: Type): boolean {
        return false;
    }

    get dateTimeRecognizer (): DateTimeRecognizer {
        return new DefaultDateTimeRecognizer();
    }
}
