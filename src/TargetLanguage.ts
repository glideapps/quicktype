"use strict";

import { TopLevelConfig } from "./Config";
import { TypeGraph } from "./TypeGraph";
import { RenderResult } from "./Renderer";
import { OptionDefinition } from "./RendererOptions";
import { serializeRenderResult, SerializedRenderResult } from "./Source";
import { RendererOptions } from "./quicktype";

export abstract class TargetLanguage {
    constructor(
        readonly displayName: string,
        readonly names: string[],
        readonly extension: string,
        readonly optionDefinitions: OptionDefinition[]
    ) {}

    renderGraphAndSerialize(graph: TypeGraph, rendererOptions: { [name: string]: any }): SerializedRenderResult {
        const renderResult = this.renderGraph(graph, rendererOptions);
        return serializeRenderResult(renderResult, this.indentation);
    }

    needsCompressedJSONInput(rendererOptions: RendererOptions): boolean {
        return true;
    }

    protected get indentation(): string {
        return "    ";
    }

    get supportsEnums(): boolean {
        return true;
    }

    protected abstract renderGraph(graph: TypeGraph, optionValues: { [name: string]: any }): RenderResult;
}
