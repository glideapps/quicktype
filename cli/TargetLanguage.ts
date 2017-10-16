"use strict";

import { List } from "immutable";

import * as Either from "Data.Either";

import { Config } from "Config";
import * as Main from "Main";
import { fromLeft, fromRight } from "./purescript";
import { TopLevels } from "./Type";
import { Renderer, RenderResult } from "./Renderer";
import { OptionDefinition, RendererOption, TypedRendererOption } from "./RendererOptions";
import { glueGraphToNative } from "./Glue";
import { serializeSource } from "./Source";

export abstract class TargetLanguage {
    readonly optionDefinitions: OptionDefinition[];

    constructor(
        readonly displayName: string,
        readonly names: string[],
        readonly extension: string,
        readonly aceMode: string,
        options: RendererOption[]
    ) {
        this.optionDefinitions = options.map((o: RendererOption) => o.definition);
    }

    abstract transformAndRenderConfig(config: Config): string;
}

export abstract class TypeScriptTargetLanguage extends TargetLanguage {
    transformAndRenderConfig(config: Config): string {
        const glueGraphOrError = Main.glueGraphFromJsonConfig(config);
        if (Either.isLeft(glueGraphOrError)) {
            console.error(`Error processing JSON: ${fromLeft(glueGraphOrError)}`);
            process.exit(1);
        }
        const glueGraph = fromRight(glueGraphOrError);
        const graph = glueGraphToNative(glueGraph);
        const { source, names } = this.renderGraph(graph, config.rendererOptions);
        return serializeSource(source, names);
    }

    abstract renderGraph(topLevels: TopLevels, optionValues: { [name: string]: any }): RenderResult;
}

/*
class PureScriptTargetLanguage extends TargetLanguage {


}
*/
