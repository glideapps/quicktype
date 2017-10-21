"use strict";

import { List, Map, Range } from "immutable";

import { Annotation } from "./Annotation";
import { Name } from "./Naming";
import { intercalate } from "./Support";
import { RenderResult } from "./Renderer";

export type Source =
    | TextSource
    | NewlineSource
    | SequenceSource
    | TableSource
    | AnnotatedSource
    | NameSource;

export interface TextSource {
    kind: "text";
    text: string;
}

export interface NewlineSource {
    kind: "newline";
    // Number of indentation levels (not spaces!) to change
    // the rest of the source by.  Positive numbers mean
    // indent more, negative mean indent less.  The most
    // common value will be zero, for no change in
    // indentation.
    indentationChange: number;
}

export interface SequenceSource {
    kind: "sequence";
    sequence: List<Source>;
}

export interface TableSource {
    kind: "table";
    table: List<List<Source>>;
}

export interface AnnotatedSource {
    kind: "annotated";
    annotation: Annotation;
    source: Source;
}

export interface NameSource {
    kind: "name";
    named: Name;
}

export function newline(): NewlineSource {
    // FIXME: use singleton?
    return { kind: "newline", indentationChange: 0 };
}

export type Sourcelike = Source | string | Name | SourcelikeArray;
export interface SourcelikeArray extends Array<Sourcelike> {}

export function sourcelikeToSource(sl: Sourcelike): Source {
    if (sl instanceof Array) {
        return {
            kind: "sequence",
            sequence: List(sl.map(sourcelikeToSource))
        };
    }
    if (typeof sl === "string") {
        const lines = sl.split("\n");
        if (lines.length === 1) {
            return { kind: "text", text: sl };
        }
        return {
            kind: "sequence",
            sequence: intercalate(
                newline(),
                List(lines).map((l: string) => ({ kind: "text", text: l } as Source))
            ).toList()
        };
    }
    if (sl instanceof Name) {
        return { kind: "name", named: sl };
    }
    return sl;
}

export function annotated(annotation: Annotation, sl: Sourcelike): Source {
    return {
        kind: "annotated",
        annotation,
        source: sourcelikeToSource(sl)
    };
}

export function maybeAnnotated(
    doAnnotate: boolean,
    annotation: Annotation,
    sl: Sourcelike
): Sourcelike {
    if (!doAnnotate) {
        return sl;
    }
    return annotated(annotation, sl);
}

function assertNever(x: never): never {
    throw new Error("Unexpected object: " + x);
}

export interface Location {
    // Both of these are zero-based.
    line: number;
    column: number;
}

export interface Span {
    start: Location;
    end: Location;
}

// FIXME: This is badly named.  This is more user-facing, so it should probably
// be named `Annotation`, so what do we rename `Annotation` to?
export interface SourceAnnotation {
    annotation: Annotation;
    span: Span;
}

export interface SerializedRenderResult {
    lines: string[];
    annotations: List<SourceAnnotation>;
}

function sourceLineLength(source: Source, names: Map<Name, string>): number {
    switch (source.kind) {
        case "text":
            return source.text.length;
        case "newline":
            throw "Newline must not occur within a line.";
        case "sequence":
            return source.sequence
                .map((s: Source) => sourceLineLength(s, names))
                .reduce((a: number, b: number) => a + b, 0);
        case "table":
            throw "Table must not occur within a  line.";
        case "annotated":
            return sourceLineLength(source.source, names);
        case "name":
            if (!names.has(source.named)) {
                throw "No name for Named";
            }
            return names.get(source.named).length;
        default:
            return assertNever(source);
    }
}

export function serializeRenderResult(
    { source, names }: RenderResult,
    indentation: string
): SerializedRenderResult {
    let indent = 0;
    let indentNeeded = 0;

    const lines: string[] = [];
    let currentLine: string[] = [];
    const annotations: SourceAnnotation[] = [];

    function indentIfNeeded(): void {
        if (indentNeeded === 0) return;
        currentLine.push(indentation.repeat(indentNeeded));
        indentNeeded = 0;
    }

    function flattenCurrentLine(): string {
        const str = currentLine.join("");
        currentLine = [str];
        return str;
    }

    function currentLocation(): Location {
        return { line: lines.length, column: flattenCurrentLine().length };
    }

    function finishLine(): void {
        lines.push(flattenCurrentLine());
        currentLine = [];
    }

    // FIXME: We shouldn't have to pass `names` here.
    function serializeToStringArray(source: Source, names: Map<Name, string>): void {
        switch (source.kind) {
            case "text":
                indentIfNeeded();
                currentLine.push(source.text);
                break;
            case "newline":
                finishLine();
                indent += source.indentationChange;
                indentNeeded = indent;
                break;
            case "sequence":
                source.sequence.forEach((s: Source) => serializeToStringArray(s, names));
                break;
            case "table":
                const t = source.table;
                const widths = t
                    .map((l: List<Source>) =>
                        l.map((s: Source) => sourceLineLength(s, names)).toList()
                    )
                    .toList();
                const numRows = t.size;
                const numColumns = t.map((l: List<Source>) => l.size).max();
                const columnWidths = Range(0, numColumns).map((i: number) =>
                    widths.map((l: List<number>) => l.get(i)).max()
                );
                for (let y = 0; y < numRows; y++) {
                    indentIfNeeded();
                    const row = t.get(y);
                    const rowWidths = widths.get(y);
                    for (let x = 0; x < numColumns; x++) {
                        const colWidth = columnWidths.get(x);
                        const src = row.get(x);
                        const srcWidth = rowWidths.get(x);
                        serializeToStringArray(src, names);
                        if (srcWidth < colWidth) {
                            currentLine.push(" ".repeat(colWidth - srcWidth));
                        }
                    }
                    if (y < numRows - 1) {
                        finishLine();
                        indentNeeded = indent;
                    }
                }
                break;
            case "annotated":
                const start = currentLocation();
                serializeToStringArray(source.source, names);
                const end = currentLocation();
                annotations.push({ annotation: source.annotation, span: { start, end } });
                break;
            case "name":
                if (!names.has(source.named)) {
                    throw "No name for Named";
                }
                indentIfNeeded();
                currentLine.push(names.get(source.named));
                break;
            default:
                return assertNever(source);
        }
    }

    serializeToStringArray(source, names);
    finishLine();
    return { lines, annotations: List(annotations) };
}
