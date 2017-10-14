"use strict";

import { List } from "immutable";

import { Graph } from "./Type";
import { Renderer, RenderResult } from "./Renderer";
import { OptionDefinition, RendererOption, TypedRendererOption } from "./Options";

export abstract class TargetLanguage {
    readonly options: List<RendererOption>;

    constructor(options: RendererOption[]) {
        this.options = List(options);
    }

    abstract renderGraph(topLevels: Graph, optionValues: { [name: string]: any }): RenderResult;

    get optionDefinitions(): OptionDefinition[] {
        return this.options.map((o: RendererOption) => o.definition).toArray();
    }
}
