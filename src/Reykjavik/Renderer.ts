"use strict";

import { Map } from "immutable";
import { Graph } from "./Type";
import { Named } from "./Naming";
import {
    Source,
    Sourcelike,
    sourcelikeToSource,
    serializeSource
} from "./Source";

export abstract class Renderer {
    protected readonly topLevels: Graph;
    private source?: Source;
    protected names?: Map<Named, string>;

    constructor(topLevels: Graph) {
        this.topLevels = topLevels;
    }

    protected abstract render(): Sourcelike;

    get serializedSource(): string {
        if (!this.source) {
            this.source = sourcelikeToSource(this.render());
        }
        if (!this.names) {
            throw "Renderer did not assign names";
        }
        return serializeSource(this.source, this.names);
    }
}
