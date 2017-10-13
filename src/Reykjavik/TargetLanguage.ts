"use strict";

import { List } from "immutable";

import { Graph } from "./Type";
import { Renderer } from "./Renderer";
import { OptionDefinition, RendererOption, TypedRendererOption } from "./Options";

export abstract class TargetLanguage {
    readonly options: List<RendererOption>;

    constructor(options: RendererOption[]) {
        this.options = List(options);
    }

    abstract getRenderer(topLevels: Graph, optionValues: { [name: string]: any }): Renderer;

    get optionDefinitions(): OptionDefinition[] {
        return this.options.map((o: RendererOption) => o.definition).toArray();
    }
}
