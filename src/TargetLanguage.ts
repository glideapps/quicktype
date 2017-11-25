"use strict";

import { List, Map } from "immutable";

import { Config, TopLevelConfig } from "./Config";
import { Type } from "./Type";
import { TypeGraph } from "./TypeBuilder";
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

    transformAndRenderConfig(config: Config): SerializedRenderResult {
        const graph = new TypeGraph();
        if (config.isInputJSONSchema) {
            for (const tlc of config.topLevels) {
                graph.addTopLevel(tlc.name, schemaToType(graph, tlc.name, (tlc as any).schema));
            }
        } else {
            const inference = new TypeInference(graph, config.inferMaps, this.supportsEnums && config.inferEnums);
            config.topLevels.forEach(tlc => {
                graph.addTopLevel(
                    tlc.name,
                    inference.inferType(config.compressedJSON as CompressedJSON, tlc.name, (tlc as any).samples)
                );
            });
            if (config.combineClasses) {
                combineClasses(graph);
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

    protected abstract renderGraph(graph: TypeGraph, optionValues: { [name: string]: any }): RenderResult;
}
