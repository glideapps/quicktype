"use strict";

import { List } from "immutable";

import { TopLevels } from "./Type";
import { Renderer, RenderResult } from "./Renderer";
import { OptionDefinition, RendererOption, TypedRendererOption } from "./Options";

export abstract class TargetLanguage {
    readonly displayName: string;
    readonly names: string[];
    readonly extension: string;
    readonly aceMode: string;
    readonly optionDefinitions: OptionDefinition[];

    constructor(
        displayName: string,
        names: string[],
        extension: string,
        aceMode: string,
        options: RendererOption[]
    ) {
        this.displayName = displayName;
        this.names = names;
        this.extension = extension;
        this.aceMode = aceMode;
        this.optionDefinitions = options.map((o: RendererOption) => o.definition);
    }

    abstract renderGraph(topLevels: TopLevels, optionValues: { [name: string]: any }): RenderResult;
}
