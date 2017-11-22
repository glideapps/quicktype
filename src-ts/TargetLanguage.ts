"use strict";

import { List, Map } from "immutable";

import * as Either from "Data.Either";

import { Config, TopLevelConfig } from "Config";
import * as Main from "Main";
import { Renderer } from "Doc";
import * as Options from "Options";
import { fromLeft, fromRight } from "./purescript";
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

function optionSpecificationToOptionDefinition(spec: Options.OptionSpecification): OptionDefinition {
    const valueType = Options.valueType(spec.default);
    const type = valueType === "BooleanValue" ? Boolean : String;

    let legalValues;
    let defaultValue = spec.default.value0;
    if (valueType === "EnumValue") {
        const { value1 } = spec.default as Options.EnumValue;
        legalValues = value1;
        defaultValue = legalValues[defaultValue as number];
    }

    return {
        name: spec.name,
        description: spec.description,
        typeLabel: spec.typeLabel,
        renderer: true,
        type,
        legalValues,
        defaultValue
    };
}

function optionDefinitionsForRenderer(renderer: Renderer): OptionDefinition[] {
    return renderer.options.map(optionSpecificationToOptionDefinition);
}

export class PureScriptTargetLanguage extends TargetLanguage {
    constructor(renderer: Renderer) {
        const optionDefinitions = optionDefinitionsForRenderer(renderer);
        super(renderer.displayName, renderer.names, renderer.extension, optionDefinitions);
    }

    transformAndRenderConfig(config: Config): SerializedRenderResult {
        // The PureScript rendering pipeline expects option values to be strings.
        // TargetLangauges expect options to be strings or booleans
        // So we stringify the booleans.
        let options = config.rendererOptions;
        config.rendererOptions = {};
        for (let key of Object.keys(options)) {
            config.rendererOptions[key] = options[key].toString();
        }
        config.language = this.names[0];

        const resultOrError = Main.main(config);
        if (Either.isLeft(resultOrError)) {
            throw `Error: ${fromLeft(resultOrError)}`;
        }
        const source = fromRight(resultOrError);
        return { lines: source.split("\n"), annotations: List() };
    }

    needsCompressedJSONInput(rendererOptions: RendererOptions): boolean {
        return false;
    }
}
