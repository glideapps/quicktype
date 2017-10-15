"use strict";

import { Map, Iterable } from "immutable";
import { TopLevels } from "./Type";
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
    protected readonly _topLevels: TopLevels;

    private _lastNewline?: NewlineSource;
    private _emitted: Sourcelike[];

    constructor(topLevels: TopLevels) {
        this._topLevels = topLevels;
        this._emitted = [];
    }

    emitNewline(): void {
        const nl = newline();
        this._emitted.push(nl);
        this._lastNewline = nl;
    }

    emitLine(line: Sourcelike): void {
        this._emitted.push(line);
        this.emitNewline();
    }

    private changeIndent(offset: number): void {
        if (!this._lastNewline) {
            throw "Cannot change indent for the first line";
        }
        this._lastNewline.indentationChange += offset;
    }

    forEach<K, V>(
        iterable: Iterable<K, V>,
        interposedBlankLines: boolean,
        leadingBlankLine: boolean,
        emitter: (v: V, k: K) => void
    ): void {
        let needBlank = false;
        iterable.forEach((v: V, k: K) => {
            if (leadingBlankLine || (interposedBlankLines && needBlank)) {
                this.emitNewline();
            }
            emitter(v, k);
            needBlank = true;
        });
    }

    forEachWithLeadingAndInterposedBlankLines<K, V>(
        iterable: Iterable<K, V>,
        emitter: (v: V, k: K) => void
    ): void {
        this.forEach(iterable, true, true, emitter);
    }

    indent(fn: () => void): void {
        this.changeIndent(1);
        fn();
        this.changeIndent(-1);
    }

    finishedSource = (): Source => {
        return sourcelikeToSource(this._emitted);
    };

    abstract render(): RenderResult;
}
