"use strict";

import { Map, Collection, OrderedSet, List } from "immutable";
import { TypeGraph } from "./TypeGraph";
import { Name, Namespace, assignNames } from "./Naming";
import { Source, Sourcelike, NewlineSource, annotated, sourcelikeToSource, newline } from "./Source";
import { AnnotationData, IssueAnnotationData } from "./Annotation";
import { assert, panic } from "./Support";

export type RenderResult = { rootSource: Source; names: Map<Name, string> };

export type BlankLineLocations = "none" | "interposing" | "leading" | "leading-and-interposing";

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
    private _names: Map<Name, string> | undefined;

    private _lastNewline?: NewlineSource;
    private _emitted: Sourcelike[];
    private _currentEmitTarget: Sourcelike[];

    constructor(protected readonly typeGraph: TypeGraph) {
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
            assert(indent % 4 === 0, "Indentation is not a multiple of 4.");
            if (text !== null) {
                const newIndent = indent / 4;
                this.changeIndent(newIndent - currentIndent);
                currentIndent = newIndent;
                this.emitLine(text);
            } else {
                this.emitNewline();
            }
        }
        if (currentIndent !== 0) {
            this.changeIndent(-currentIndent);
        }
    }

    emitAnnotated(annotation: AnnotationData, emitter: () => void): void {
        const oldEmitTarget: Sourcelike[] = this._currentEmitTarget;
        const emitTarget: Sourcelike[] = [];
        this._currentEmitTarget = emitTarget;
        emitter();
        assert(this._currentEmitTarget === emitTarget, "_currentEmitTarget not restored correctly");
        this._currentEmitTarget = oldEmitTarget;
        const source = sourcelikeToSource(emitTarget);
        this._currentEmitTarget.push(annotated(annotation, source));
    }

    emitIssue(message: string, emitter: () => void): void {
        this.emitAnnotated(new IssueAnnotationData(message), emitter);
    }

    protected emitTable = (tableArray: Sourcelike[][]): void => {
        const table = List(tableArray.map(r => List(r.map(sl => sourcelikeToSource(sl)))));
        this._currentEmitTarget.push({ kind: "table", table });
        this.emitNewline();
    };

    private changeIndent(offset: number): void {
        if (!this._lastNewline) {
            return panic("Cannot change indent for the first line");
        }
        this._lastNewline.indentationChange += offset;
    }

    forEach<K, V>(
        iterable: Collection<K, V>,
        interposedBlankLines: boolean,
        leadingBlankLine: boolean,
        emitter: (v: V, k: K) => void
    ): void {
        let onFirst = true;
        iterable.forEach((v: V, k: K) => {
            if ((leadingBlankLine && onFirst) || (interposedBlankLines && !onFirst)) {
                this.emitNewline();
            }
            emitter(v, k);
            onFirst = false;
        });
    }

    forEachWithBlankLines<K, V>(
        iterable: Collection<K, V>,
        blankLineLocations: BlankLineLocations,
        emitter: (v: V, k: K) => void
    ): void {
        const interposing = ["interposing", "leading-and-interposing"].indexOf(blankLineLocations) >= 0;
        const leading = ["leading", "leading-and-interposing"].indexOf(blankLineLocations) >= 0;
        this.forEach(iterable, interposing, leading, emitter);
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
        return { rootSource: this.finishedSource(), names: this._names };
    };

    get names(): Map<Name, string> {
        if (this._names === undefined) {
            return panic("Names accessed before they were assigned");
        }
        return this._names;
    }
}
