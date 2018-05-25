import { Map, Collection, OrderedSet, List, OrderedMap } from "immutable";

import { TypeGraph } from "./TypeGraph";
import { Name, Namespace, assignNames } from "./Naming";
import { Source, Sourcelike, NewlineSource, annotated, sourcelikeToSource, newline } from "./Source";
import { AnnotationData, IssueAnnotationData } from "./Annotation";
import { assert, panic } from "./support/Support";
import { TargetLanguage } from "./TargetLanguage";

export type RenderResult = {
    sources: OrderedMap<string, Source>;
    names: Map<Name, string>;
};

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

export type RenderContext = {
    typeGraph: TypeGraph;
    leadingComments: string[] | undefined;
};

export abstract class Renderer {
    protected readonly typeGraph: TypeGraph;
    protected readonly leadingComments: string[] | undefined;

    private _names: Map<Name, string> | undefined;
    private _finishedFiles: OrderedMap<string, Source>;

    private _lastNewline?: NewlineSource;
    // @ts-ignore: Initialized in startEmit, which is called from the constructor
    private _emitted: Sourcelike[];
    // @ts-ignore: Initialized in startEmit, which is called from the constructor
    private _currentEmitTarget: Sourcelike[];
    // @ts-ignore: Initialized in startEmit, which is called from the constructor
    private _needBlankLine: boolean;
    // @ts-ignore: Initialized in startEmit, which is called from the constructor
    private _preventBlankLine: boolean;

    constructor(protected readonly targetLanguage: TargetLanguage, renderContext: RenderContext) {
        this.typeGraph = renderContext.typeGraph;
        this.leadingComments = renderContext.leadingComments;

        this._finishedFiles = Map();
        this.startEmit();
    }

    private startEmit(): void {
        this._currentEmitTarget = this._emitted = [];
        this._needBlankLine = false;
        this._preventBlankLine = true; // no blank lines at start of file
    }

    private pushItem(item: Sourcelike): void {
        this._currentEmitTarget.push(item);
        this._preventBlankLine = false;
    }

    private emitNewline = (): void => {
        const nl = newline();
        this.pushItem(nl);
        this._lastNewline = nl;
    };

    private emitItem = (item: Sourcelike): void => {
        if (this._needBlankLine) {
            this.emitNewline();
            this._needBlankLine = false;
        }
        this.pushItem(item);
    };

    protected ensureBlankLine(): void {
        if (this._preventBlankLine) return;
        this._needBlankLine = true;
    }

    protected preventBlankLine(): void {
        this._needBlankLine = false;
        this._preventBlankLine = true;
    }

    emitLine(...lineParts: Sourcelike[]): void {
        if (lineParts.length === 1) {
            this.emitItem(lineParts[0]);
        } else if (lineParts.length > 1) {
            this.emitItem(lineParts);
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
        this.pushItem(annotated(annotation, source));
    }

    emitIssue(message: string, emitter: () => void): void {
        this.emitAnnotated(new IssueAnnotationData(message), emitter);
    }

    protected emitTable = (tableArray: Sourcelike[][]): void => {
        if (tableArray.length === 0) return;
        const table = List(tableArray.map(r => List(r.map(sl => sourcelikeToSource(sl)))));
        this.emitItem({ kind: "table", table });
        this.emitNewline();
    };

    private changeIndent(offset: number): void {
        if (this._lastNewline === undefined) {
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
                this.ensureBlankLine();
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

    protected abstract setUpNaming(): OrderedSet<Namespace>;
    protected abstract emitSource(givenOutputFilename: string): void;

    private assignNames(): Map<Name, string> {
        return assignNames(this.setUpNaming());
    }

    protected finishFile(filename: string): void {
        assert(!this._finishedFiles.has(filename), `Tried to emit file ${filename} more than once`);
        const source = sourcelikeToSource(this._emitted);
        this._finishedFiles = this._finishedFiles.set(filename, source);
        this.startEmit();
    }

    render(givenOutputFilename: string): RenderResult {
        this._names = this.assignNames();
        this.emitSource(givenOutputFilename);
        if (this._emitted.length > 0) {
            this.finishFile(givenOutputFilename);
        }
        return { sources: this._finishedFiles, names: this._names };
    }

    get names(): Map<Name, string> {
        if (this._names === undefined) {
            return panic("Names accessed before they were assigned");
        }
        return this._names;
    }
}
