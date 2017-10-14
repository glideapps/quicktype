"use strict";

import { Map, Iterable } from "immutable";
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

export type RenderResult = { source: Source; names: Map<Named, string> };

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

    forEach<K, V>(
        iterable: Iterable<K, V>,
        withBlankLines: boolean,
        emitter: (v: V, k: K) => void
    ): void {
        let needBlank = false;
        iterable.forEach((v: V, k: K) => {
            if (withBlankLines && needBlank) {
                this.emitNewline();
            }
            emitter(v, k);
            needBlank = true;
        });
    }

    forEachWithBlankLines<K, V>(iterable: Iterable<K, V>, emitter: (v: V, k: K) => void): void {
        this.forEach(iterable, true, emitter);
    }

    indent(fn: () => void): void {
        this.changeIndent(1);
        fn();
        this.changeIndent(-1);
    }

    finishedSource = (): Source => {
        return sourcelikeToSource(this.emitted);
    };

    abstract render(): RenderResult;
}
