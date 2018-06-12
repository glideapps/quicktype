import { mapMap } from "collection-utils";

import { TypeGraph } from "./TypeGraph";
import { Renderer, RenderContext } from "./Renderer";
import { OptionDefinition, Option } from "./RendererOptions";
import { serializeRenderResult, SerializedRenderResult } from "./Source";
import { StringTypeMapping } from "./TypeBuilder";
import { defined } from "./support/Support";
import { ConvenienceRenderer } from "./ConvenienceRenderer";
import { Type } from "./Type";

export abstract class TargetLanguage {
    constructor(readonly displayName: string, readonly names: string[], readonly extension: string) {}

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

    get name(): string {
        return defined(this.names[0]);
    }

    protected abstract makeRenderer(renderContext: RenderContext, optionValues: { [name: string]: any }): Renderer;

    renderGraphAndSerialize(
        typeGraph: TypeGraph,
        givenOutputFilename: string,
        alphabetizeProperties: boolean,
        leadingComments: string[] | undefined,
        rendererOptions: { [name: string]: any },
        indentation?: string
    ): ReadonlyMap<string, SerializedRenderResult> {
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

    protected get partialStringTypeMapping(): Partial<StringTypeMapping> {
        return {};
    }

    get stringTypeMapping(): StringTypeMapping {
        const partial = this.partialStringTypeMapping;
        /* tslint:disable:strict-boolean-expressions */
        return {
            date: partial.date || "string",
            time: partial.time || "string",
            dateTime: partial.dateTime || "string"
        };
        /* tslint:enable */
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
}
