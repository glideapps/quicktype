"use strict";

import { Map } from "immutable";
import { Graph } from "./Type";
import { Named } from "./Naming";
import {
    Source,
    Sourcelike,
    NewlineSource,
    sourcelikeToSource,
    serializeSource,
    newline
} from "./Source";

export abstract class Renderer {
    protected readonly topLevels: Graph;
    private source?: Source;
    protected names?: Map<Named, string>;

    private lastNewline?: NewlineSource;
    private emitted: Sourcelike[];

    constructor(topLevels: Graph) {
        this.topLevels = topLevels;
        this.emitted = [];
    }

    emitNewline(): void {
        const nl = newline();
        this.emitted.push(nl);
        this.lastNewline = nl;
    }

    emitLine(line: Sourcelike): void {
        this.emitted.push(line);
        this.emitNewline();
    }

    private changeIndent(offset: number): void {
        if (!this.lastNewline) {
            throw "Cannot change indent for the first line";
        }
        this.lastNewline.indentationChange += offset;
    }

    indent(fn: () => void): void {
        this.changeIndent(1);
        fn();
        this.changeIndent(-1);
    }

    finishedSource = (): Source => {
        return sourcelikeToSource(this.emitted);
    };

    protected abstract render(): Source;

    serializedSource(): string {
        if (!this.source) {
            this.source = this.render();
        }
        if (!this.names) {
            throw "Renderer did not assign names";
        }
        return serializeSource(this.source, this.names);
    }
}
