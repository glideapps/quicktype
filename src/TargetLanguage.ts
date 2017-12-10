"use strict";

import { TypeGraph } from "./TypeGraph";
import { RenderResult } from "./Renderer";
import { OptionDefinition, Option } from "./RendererOptions";
import { serializeRenderResult, SerializedRenderResult } from "./Source";
import { StringTypeMapping } from "./TypeBuilder";
import { assert, panic } from "./Support";

export abstract class TargetLanguage {
    private _optionDefinitions?: OptionDefinition[] | undefined;

    constructor(readonly displayName: string, readonly names: string[], readonly extension: string) {}

    protected setOptions = (options: Option<any>[]): void => {
        assert(
            this._optionDefinitions === undefined,
            `Target language ${this.displayName} sets its options more than once`
        );
        this._optionDefinitions = options.map(o => o.definition);
    };

    get optionDefinitions(): OptionDefinition[] {
        if (this._optionDefinitions === undefined) {
            return panic(`Target language ${this.displayName} did not set its options`);
        }
        return this._optionDefinitions;
    }

    renderGraphAndSerialize(graph: TypeGraph, rendererOptions: { [name: string]: any }): SerializedRenderResult {
        assert(this._optionDefinitions !== undefined, `Target language ${this.displayName} did not set its options`);
        const renderResult = this.renderGraph(graph, rendererOptions);
        return serializeRenderResult(renderResult, this.indentation);
    }

    protected get indentation(): string {
        return "    ";
    }

    protected get partialStringTypeMapping(): Partial<StringTypeMapping> {
        return {};
    }

    get stringTypeMapping(): StringTypeMapping {
        const partial = this.partialStringTypeMapping;
        return {
            date: partial.date || "string",
            time: partial.time || "string",
            dateTime: partial.dateTime || "string"
        };
    }

    protected abstract renderGraph(graph: TypeGraph, optionValues: { [name: string]: any }): RenderResult;
}
