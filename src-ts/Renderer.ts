"use strict";

import { Map, Iterable, OrderedSet, List } from "immutable";
import { TopLevels } from "./Type";
import { Name, Namespace, assignNames } from "./Naming";
import {
    Source,
    Sourcelike,
    NewlineSource,
    annotated,
    sourcelikeToSource,
    newline
} from "./Source";
import { Annotation, IssueAnnotation } from "./Annotation";

export type RenderResult = { source: Source; names: Map<Name, string> };

export type BlankLineLocations = "none" | "leading-and-interposing";

function lineIndentation(line: string): { indent: number; text: string | null } {
    const len = line.length;
    let indent = 0;
    for (let i = 0; i < len; i++) {
        const c = line.charAt(i);
        if (c === " ") {
            indent += 1;
        } else if (c === "\t") {
            indent = (indent / 4 + 1) * 4;
        } else {
            return { indent, text: line.substring(i) };
        }
    }
    return { indent: 0, text: null };
}

export abstract class Renderer {
    protected readonly topLevels: TopLevels;
    private _names: Map<Name, string> | undefined;

    private _lastNewline?: NewlineSource;
    private _emitted: Sourcelike[];
    private _currentEmitTarget: Sourcelike[];

    constructor(topLevels: TopLevels) {
        this.topLevels = topLevels;
        this._currentEmitTarget = this._emitted = [];
    }

    emitNewline(): void {
        const nl = newline();
        this._currentEmitTarget.push(nl);
        this._lastNewline = nl;
    }

    emitLine(...lineParts: Sourcelike[]): void {
        if (lineParts.length === 1) {
            this._currentEmitTarget.push(lineParts[0]);
        } else if (lineParts.length > 1) {
            this._currentEmitTarget.push(lineParts);
        }
        this.emitNewline();
    }

    emitMultiline(linesString: string): void {
        const lines = linesString.split("\n");
        const numLines = lines.length;
        if (numLines === 0) return;
        this.emitLine(lines[0]);
        let currentIndent = 0;
        for (let i = 1; i < numLines; i++) {
            const line = lines[i];
            const { indent, text } = lineIndentation(line);
            if (indent % 4 !== 0) {
                throw "Indentation is not a multiple of 4.";
            }
            if (text !== null) {
                const newIndent = indent / 4;
                this.changeIndent(newIndent - currentIndent);
                currentIndent = newIndent;
                this.emitLine(text);
            } else {
                this.emitNewline();
            }
        }
    }

    emitAnnotated(annotation: Annotation, emitter: () => void): void {
        const oldEmitTarget: Sourcelike[] = this._currentEmitTarget;
        const emitTarget: Sourcelike[] = [];
        this._currentEmitTarget = emitTarget;
        emitter();
        if (this._currentEmitTarget !== emitTarget) {
            throw "_currentEmitTarget not restored correctly";
        }
        this._currentEmitTarget = oldEmitTarget;
        const source = sourcelikeToSource(emitTarget);
        this._currentEmitTarget.push(annotated(annotation, source));
    }

    emitIssue(message: string, emitter: () => void): void {
        this.emitAnnotated(new IssueAnnotation(message), emitter);
    }

    protected emitTable = (tableArray: Sourcelike[][]): void => {
        const table = List(tableArray.map(r => List(r.map(sl => sourcelikeToSource(sl)))));
        this._currentEmitTarget.push({ kind: "table", table });
        this.emitNewline();
    };

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

    forEachWithBlankLines<K, V>(
        iterable: Iterable<K, V>,
        blankLineLocations: BlankLineLocations,
        emitter: (v: V, k: K) => void
    ): void {
        this.forEach(iterable, blankLineLocations != "none", blankLineLocations != "none", emitter);
    }

    indent(fn: () => void): void {
        this.changeIndent(1);
        fn();
        this.changeIndent(-1);
    }

    finishedSource = (): Source => {
        return sourcelikeToSource(this._emitted);
    };

    protected abstract setUpNaming(): Namespace[];
    protected abstract emitSource(): void;

    render = (): RenderResult => {
        this._names = assignNames(OrderedSet(this.setUpNaming()));
        this.emitSource();
        return { source: this.finishedSource(), names: this._names };
    };

    get names(): Map<Name, string> {
        if (this._names === undefined) {
            throw "Names accessed before they were assigned";
        }
        return this._names;
    }
}
