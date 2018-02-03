"use strict";

import { List, OrderedMap } from "immutable";

import { TypeGraph } from "./TypeGraph";
import { Renderer } from "./Renderer";
import { OptionDefinition, Option } from "./RendererOptions";
import { serializeRenderResult, SerializedRenderResult } from "./Source";
import { StringTypeMapping } from "./TypeBuilder";
import { assert, panic, defined } from "./Support";
import { ConvenienceRenderer } from "./ConvenienceRenderer";

export abstract class TargetLanguage {
    private _options?: Option<any>[];

    constructor(readonly displayName: string, readonly names: string[], readonly extension: string) {}

    protected setOptions = (options: Option<any>[]): void => {
        assert(this._options === undefined, `Target language ${this.displayName} sets its options more than once`);
        this._options = options;
    };

    get optionDefinitions(): OptionDefinition[] {
        if (this._options === undefined) {
            return panic(`Target language ${this.displayName} did not set its options`);
        }
        return this._options.map(o => o.definition);
    }

    protected abstract get rendererClass(): new (
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => Renderer;

    private makeRenderer(
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        rendererOptions: { [name: string]: any }
    ): Renderer {
        if (this._options === undefined) {
            return panic(`Target language ${this.displayName} did not set its options`);
        }
        return new this.rendererClass(graph, leadingComments, ...this._options.map(o => o.getValue(rendererOptions)));
    }

    renderGraphAndSerialize(
        graph: TypeGraph,
        givenOutputFilename: string,
        alphabetizeProperties: boolean,
        leadingComments: string[] | undefined,
        rendererOptions: { [name: string]: any },
        indentation?: string
    ): OrderedMap<string, SerializedRenderResult> {
        if (indentation === undefined) {
            indentation = this.defaultIndentation;
        }
        const renderer = this.makeRenderer(graph, leadingComments, rendererOptions);
        if ((renderer as any).setAlphabetizeProperties !== undefined) {
            (renderer as ConvenienceRenderer).setAlphabetizeProperties(alphabetizeProperties);
        }
        const renderResult = renderer.render(givenOutputFilename);
        return renderResult.sources.map(s => serializeRenderResult(s, renderResult.names, defined(indentation)));
    }

    processHandlebarsTemplate(
        graph: TypeGraph,
        rendererOptions: { [name: string]: any },
        template: string
    ): SerializedRenderResult {
        const renderer = this.makeRenderer(graph, undefined, rendererOptions);
        const output = renderer.processHandlebarsTemplate(template);
        return { lines: output.split("\n"), annotations: List() };
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
}
