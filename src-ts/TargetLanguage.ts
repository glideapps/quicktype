"use strict";

import { List, Map } from "immutable";

import { Config, TopLevelConfig } from "Config";
import { TopLevels, Type } from "./Type";
import { RenderResult } from "./Renderer";
import { OptionDefinition } from "./RendererOptions";
import { serializeRenderResult, SerializedRenderResult } from "./Source";
import { TypeInference } from "./Inference";
import { combineClasses } from "./CombineClasses";
import { CompressedJSON } from "./CompressedJSON";
import { RendererOptions } from "./quicktype";
import { schemaToType } from "./JSONSchemaInput";

export abstract class TargetLanguage {
    constructor(
        readonly displayName: string,
        readonly names: string[],
        readonly extension: string,
        readonly optionDefinitions: OptionDefinition[]
    ) {}

    abstract transformAndRenderConfig(config: Config): SerializedRenderResult;

    abstract needsCompressedJSONInput(rendererOptions: RendererOptions): boolean;
}

export abstract class TypeScriptTargetLanguage extends TargetLanguage {
    transformAndRenderConfig(config: Config): SerializedRenderResult {
        let graph: TopLevels;
        if (config.isInputJSONSchema) {
            graph = Map();
            for (const tlc of config.topLevels) {
                // FIXME: This is ugly
                graph = graph.set(tlc.name, schemaToType(tlc.name, (tlc as any).schema));
            }
        } else {
            const inference = new TypeInference(config.inferMaps, this.supportsEnums && config.inferEnums);
            graph = Map(
                config.topLevels.map((tlc: TopLevelConfig): [string, Type] => {
                    return [
                        tlc.name,
                        inference.inferType(config.compressedJSON as CompressedJSON, tlc.name, (tlc as any).samples)
                    ];
                })
            );
            if (config.combineClasses) {
                graph = combineClasses(graph);
            }
        }
        if (!config.doRender) {
            return { lines: ["Done.", ""], annotations: List() };
        }
        const renderResult = this.renderGraph(graph, config.rendererOptions);
        return serializeRenderResult(renderResult, this.indentation);
    }

    needsCompressedJSONInput(rendererOptions: RendererOptions): boolean {
        return true;
    }

    protected get indentation(): string {
        return "    ";
    }

    protected get supportsEnums(): boolean {
        return true;
    }

    protected abstract renderGraph(topLevels: TopLevels, optionValues: { [name: string]: any }): RenderResult;
}
