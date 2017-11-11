"use strict";

import { List, Map } from "immutable";

import { Config, TopLevelConfig } from "./Config";
import { Type } from "./Type";
import { TypeGraph } from "./TypeGraph";
import { RenderResult } from "./Renderer";
import { OptionDefinition } from "./RendererOptions";
import { serializeRenderResult, SerializedRenderResult } from "./Source";
import { TypeInference } from "./Inference";
import { combineClasses } from "./CombineClasses";
import { CompressedJSON } from "./CompressedJSON";
import { RendererOptions } from "./quicktype";
import { schemaToType } from "./JSONSchemaInput";
import { TypeGraphBuilder } from "./TypeBuilder";
import { inferMaps } from "./InferMaps";

export abstract class TargetLanguage {
    constructor(
        readonly displayName: string,
        readonly names: string[],
        readonly extension: string,
        readonly optionDefinitions: OptionDefinition[]
    ) {}

    transformAndRenderConfig(config: Config): SerializedRenderResult {
        const typeBuilder = new TypeGraphBuilder();
        let combine = config.combineClasses;
        if (config.isInputJSONSchema) {
            for (const tlc of config.topLevels) {
                typeBuilder.addTopLevel(tlc.name, schemaToType(typeBuilder, tlc.name, (tlc as any).schema));
            }
            combine = false;
        } else {
            const inference = new TypeInference(typeBuilder, config.inferMaps, this.supportsEnums && config.inferEnums);
            config.topLevels.forEach(tlc => {
                typeBuilder.addTopLevel(
                    tlc.name,
                    inference.inferType(config.compressedJSON as CompressedJSON, tlc.name, false, (tlc as any).samples)
                );
            });
        }
        let graph = typeBuilder.finish();
        if (!config.isInputJSONSchema) {
            if (combine) {
                graph = combineClasses(graph);
            }
            if (config.inferMaps) {
                graph = inferMaps(graph);
            }
        }
        if (!config.doRender) {
            return { lines: ["Done.", ""], annotations: List() };
        }
        /*
        let graphQLTopLevels: GraphQLTopLevelConfig[] = [];
        for (const tl of config.topLevels) {
            if (tl.hasOwnProperty("graphQLSchema")) {
                graphQLTopLevels.push(tl as GraphQLTopLevelConfig);
            } else {
                pureScriptTopLevels.push(tl);
            }
        }
        for (const tl of graphQLTopLevels) {
            graph = graph.set(tl.name, readGraphQLSchema(tl.graphQLSchema, tl.graphQLDocument));
        }
        */
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
