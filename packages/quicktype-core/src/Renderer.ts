import { iterableEnumerate } from "collection-utils";

import { type AnnotationData, IssueAnnotationData } from "./Annotation";
import { type Name, type Namespace, assignNames } from "./Naming";
import { type NewlineSource, type Source, type Sourcelike, annotated, newline, sourcelikeToSource } from "./Source";
import { type Comment } from "./support/Comments";
import { assert, panic } from "./support/Support";
import { type TargetLanguage } from "./TargetLanguage";
import { type TypeGraph } from "./TypeGraph";

export interface RenderResult {
    names: ReadonlyMap<Name, string>;
    sources: ReadonlyMap<string, Source>;
}

export type BlankLinePosition = "none" | "interposing" | "leading" | "leading-and-interposing";
export type BlankLineConfig = BlankLinePosition | [BlankLinePosition, number];

function getBlankLineConfig(cfg: BlankLineConfig): { count: number; position: BlankLinePosition } {
    if (Array.isArray(cfg)) {
        return { position: cfg[0], count: cfg[1] };
    }

    return { position: cfg, count: 1 };
}

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

export interface RenderContext {
    leadingComments?: Comment[];
    typeGraph: TypeGraph;
}

export type ForEachPosition = "first" | "last" | "middle" | "only";

class EmitContext {
    private _lastNewline?: NewlineSource;

    private readonly _emitted: Sourcelike[];

    private readonly _currentEmitTarget: Sourcelike[];

    private _numBlankLinesNeeded: number;

    private _preventBlankLine: boolean;

    public constructor() {
        this._currentEmitTarget = this._emitted = [];
        this._numBlankLinesNeeded = 0;
        this._preventBlankLine = true; // no blank lines at start of file
    }

    public get isEmpty(): boolean {
        return this._emitted.length === 0;
    }

    public get isNested(): boolean {
        return this._emitted !== this._currentEmitTarget;
    }

    public get source(): Sourcelike[] {
        return this._emitted;
    }

    public pushItem(item: Sourcelike): void {
        this._currentEmitTarget.push(item);
        this._preventBlankLine = false;
    }

    public emitNewline(): void {
        const nl = newline();
        this.pushItem(nl);
        this._lastNewline = nl;
    }

    public emitItem(item: Sourcelike): void {
        if (!this.isEmpty) {
            for (let i = 0; i < this._numBlankLinesNeeded; i++) {
                this.emitNewline();
            }
        }

        this._numBlankLinesNeeded = 0;
        this.pushItem(item);
    }

    public containsItem(item: Sourcelike): boolean {
        const existingItem = this._currentEmitTarget.find((value: Sourcelike) => item === value);
        return existingItem !== undefined;
    }

    public ensureBlankLine(numBlankLines: number): void {
        if (this._preventBlankLine) return;
        this._numBlankLinesNeeded = Math.max(this._numBlankLinesNeeded, numBlankLines);
    }

    public preventBlankLine(): void {
        this._numBlankLinesNeeded = 0;
        this._preventBlankLine = true;
    }

    public changeIndent(offset: number): void {
        if (this._lastNewline === undefined) {
            return panic("Cannot change indent for the first line");
        }

        this._lastNewline.indentationChange += offset;
    }
}

export abstract class Renderer {
    protected readonly typeGraph: TypeGraph;

    protected readonly leadingComments: Comment[] | undefined;

    private _names: ReadonlyMap<Name, string> | undefined;

    private readonly _finishedFiles: Map<string, Source>;

    private readonly _finishedEmitContexts: Map<string, EmitContext>;

    private _emitContext: EmitContext;

    public constructor(
        protected readonly targetLanguage: TargetLanguage,
        renderContext: RenderContext
    ) {
        this.typeGraph = renderContext.typeGraph;
        this.leadingComments = renderContext.leadingComments;

        this._finishedFiles = new Map();
        this._finishedEmitContexts = new Map();
        this._emitContext = new EmitContext();
    }

    // FIXME: make protected once JavaDateTimeRenderer is refactored
    public ensureBlankLine(numBlankLines = 1): void {
        this._emitContext.ensureBlankLine(numBlankLines);
    }

    protected preventBlankLine(): void {
        this._emitContext.preventBlankLine();
    }

    protected emitItem(item: Sourcelike): void {
        this._emitContext.emitItem(item);
    }

    protected emitItemOnce(item: Sourcelike): boolean {
        if (this._emitContext.containsItem(item)) {
            return false;
        }

        this.emitItem(item);
        return true;
    }

    protected emitLineOnce(...lineParts: Sourcelike[]): void {
        let lineEmitted = true;
        if (lineParts.length === 1) {
            lineEmitted = this.emitItemOnce(lineParts[0]);
        } else if (lineParts.length > 1) {
            lineEmitted = this.emitItemOnce(lineParts);
        }

        if (lineEmitted) {
            this._emitContext.emitNewline();
        }
    }

    // FIXME: make protected once JavaDateTimeRenderer is refactored
    public emitLine(...lineParts: Sourcelike[]): void {
        if (lineParts.length === 1) {
            this._emitContext.emitItem(lineParts[0]);
        } else if (lineParts.length > 1) {
            this._emitContext.emitItem(lineParts);
        }

        this._emitContext.emitNewline();
    }

    protected emitMultiline(linesString: string): void {
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
                this._emitContext.emitNewline();
            }
        }

        if (currentIndent !== 0) {
            this.changeIndent(-currentIndent);
        }
    }

    protected gatherSource(emitter: () => void): Sourcelike[] {
        const oldEmitContext = this._emitContext;
        this._emitContext = new EmitContext();
        emitter();
        assert(!this._emitContext.isNested, "emit context not restored correctly");
        const source = this._emitContext.source;
        this._emitContext = oldEmitContext;
        return source;
    }

    protected emitGatheredSource(items: Sourcelike[]): void {
        for (const item of items) {
            this._emitContext.emitItem(item);
        }
    }

    protected emitAnnotated(annotation: AnnotationData, emitter: () => void): void {
        const lines = this.gatherSource(emitter);
        const source = sourcelikeToSource(lines);
        this._emitContext.emitItem(annotated(annotation, source));
    }

    protected emitIssue(message: string, emitter: () => void): void {
        this.emitAnnotated(new IssueAnnotationData(message), emitter);
    }

    protected emitTable = (tableArray: Sourcelike[][]): void => {
        if (tableArray.length === 0) return;
        const table = tableArray.map(r => r.map(sl => sourcelikeToSource(sl)));
        this._emitContext.emitItem({ kind: "table", table });
        this._emitContext.emitNewline();
    };

    protected changeIndent(offset: number): void {
        this._emitContext.changeIndent(offset);
    }

    protected iterableForEach<T>(iterable: Iterable<T>, emitter: (v: T, position: ForEachPosition) => void): void {
        const items = Array.from(iterable);
        let onFirst = true;
        for (const [i, v] of iterableEnumerate(items)) {
            const position =
                items.length === 1 ? "only" : onFirst ? "first" : i === items.length - 1 ? "last" : "middle";
            emitter(v, position);
            onFirst = false;
        }
    }

    protected forEach<K, V>(
        iterable: Iterable<[K, V]>,
        interposedBlankLines: number,
        leadingBlankLines: number,
        emitter: (v: V, k: K, position: ForEachPosition) => void
    ): boolean {
        let didEmit = false;
        this.iterableForEach(iterable, ([k, v], position) => {
            if (position === "only" || position === "first") {
                this.ensureBlankLine(leadingBlankLines);
            } else {
                this.ensureBlankLine(interposedBlankLines);
            }

            emitter(v, k, position);
            didEmit = true;
        });
        return didEmit;
    }

    protected forEachWithBlankLines<K, V>(
        iterable: Iterable<[K, V]>,
        blankLineConfig: BlankLineConfig,
        emitter: (v: V, k: K, position: ForEachPosition) => void
    ): boolean {
        const { position, count } = getBlankLineConfig(blankLineConfig);
        const interposing = ["interposing", "leading-and-interposing"].includes(position);
        const leading = ["leading", "leading-and-interposing"].includes(position);
        return this.forEach(iterable, interposing ? count : 0, leading ? count : 0, emitter);
    }

    // FIXME: make protected once JavaDateTimeRenderer is refactored
    public indent(fn: () => void): void {
        this.changeIndent(1);
        fn();
        this.changeIndent(-1);
    }

    protected abstract setUpNaming(): Iterable<Namespace>;
    protected abstract emitSource(givenOutputFilename: string): void;

    protected assignNames(): ReadonlyMap<Name, string> {
        return assignNames(this.setUpNaming());
    }

    protected initializeEmitContextForFilename(filename: string): void {
        if (this._finishedEmitContexts.has(filename.toLowerCase())) {
            const existingEmitContext = this._finishedEmitContexts.get(filename.toLowerCase());
            if (existingEmitContext !== undefined) {
                this._emitContext = existingEmitContext;
            }
        }
    }

    protected finishFile(filename: string): void {
        if (this._finishedFiles.has(filename)) {
            console.log(
                `[WARNING] Tried to emit file ${filename} more than once. If performing multi-file output this warning can be safely ignored.`
            );
        }

        const source = sourcelikeToSource(this._emitContext.source);
        this._finishedFiles.set(filename, source);

        // [Michael Fey (@MrRooni), 2019-5-9] We save the current EmitContext for possible reuse later. We put it into the map with a lowercased version of the key so we can do a case-insensitive lookup later. The reason we lowercase it is because some schema (looking at you keyword-unions.schema) define objects of the same name with different casing. BOOL vs. bool, for example.
        this._finishedEmitContexts.set(filename.toLowerCase(), this._emitContext);
        this._emitContext = new EmitContext();
    }

    public render(givenOutputFilename: string): RenderResult {
        this._names = this.assignNames();
        this.emitSource(givenOutputFilename);
        if (!this._emitContext.isEmpty) {
            this.finishFile(givenOutputFilename);
        }

        return { sources: this._finishedFiles, names: this._names };
    }

    public get names(): ReadonlyMap<Name, string> {
        if (this._names === undefined) {
            return panic("Names accessed before they were assigned");
        }

        return this._names;
    }
}
