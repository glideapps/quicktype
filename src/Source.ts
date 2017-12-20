"use strict";

import * as _ from "lodash";

import { List, Map, Range } from "immutable";

import { AnnotationData } from "./Annotation";
import { Name } from "./Naming";
import { intercalate, defined, assertNever, panic, assert } from "./Support";
import { RenderResult } from "./Renderer";

export type Source =
    | TextSource
    | NewlineSource
    | SequenceSource
    | TableSource
    | AnnotatedSource
    | NameSource
    | ModifiedSource;

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
    annotation: AnnotationData;
    source: Source;
}

export interface NameSource {
    kind: "name";
    named: Name;
}

export interface ModifiedSource {
    kind: "modified";
    modifier: (serialized: string) => string;
    source: Source;
}

export function newline(): NewlineSource {
    // We're returning a new object instead of using a singleton
    // here because `Renderer` will modify `indentationChange`.
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

export function annotated(annotation: AnnotationData, sl: Sourcelike): Source {
    return {
        kind: "annotated",
        annotation,
        source: sourcelikeToSource(sl)
    };
}

export function maybeAnnotated(doAnnotate: boolean, annotation: AnnotationData, sl: Sourcelike): Sourcelike {
    if (!doAnnotate) {
        return sl;
    }
    return annotated(annotation, sl);
}

export function modifySource(modifier: (serialized: string) => string, sl: Sourcelike): Sourcelike {
    return {
        kind: "modified",
        modifier,
        source: sourcelikeToSource(sl)
    };
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

export interface Annotation {
    annotation: AnnotationData;
    span: Span;
}

export interface SerializedRenderResult {
    lines: string[];
    annotations: List<Annotation>;
}

function sourceLineLength(source: Source, names: Map<Name, string>): number {
    switch (source.kind) {
        case "text":
            return source.text.length;
        case "newline":
            return panic("Newline must not occur within a line.");
        case "sequence":
            return source.sequence
                .map((s: Source) => sourceLineLength(s, names))
                .reduce((a: number, b: number) => a + b, 0);
        case "table":
            return panic("Table must not occur within a  line.");
        case "annotated":
            return sourceLineLength(source.source, names);
        case "name":
            return defined(names.get(source.named)).length;
        case "modified":
            return serializeRenderResult({ rootSource: source, names }, "").lines.join("\n").length;
        default:
            return assertNever(source);
    }
}

export function serializeRenderResult(
    { rootSource, names }: RenderResult,
    indentation: string
): SerializedRenderResult {
    let indent = 0;
    let indentNeeded = 0;

    const lines: string[] = [];
    let currentLine: string[] = [];
    const annotations: Annotation[] = [];

    function indentIfNeeded(): void {
        if (indentNeeded === 0) return;
        currentLine.push(_.repeat(indentation, indentNeeded));
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

    function serializeToStringArray(source: Source): void {
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
                source.sequence.forEach((s: Source) => serializeToStringArray(s));
                break;
            case "table":
                const t = source.table;
                const widths = t
                    .map((l: List<Source>) => l.map((s: Source) => sourceLineLength(s, names)).toList())
                    .toList();
                const numRows = t.size;
                if (numRows === 0) break;
                const numColumns = defined(t.map((l: List<Source>) => l.size).max());
                if (numColumns === 0) break;
                const columnWidths = defined(
                    Range(0, numColumns).map((i: number) => widths.map((l: List<number>) => l.get(i) || 0).max())
                );
                for (let y = 0; y < numRows; y++) {
                    indentIfNeeded();
                    const row = defined(t.get(y));
                    const rowWidths = defined(widths.get(y));
                    for (let x = 0; x < numColumns; x++) {
                        const colWidth = defined(columnWidths.get(x));
                        const src = row.get(x) || { kind: "text", text: "" };
                        const srcWidth = rowWidths.get(x) || 0;
                        serializeToStringArray(src);
                        if (x < numColumns - 1 && srcWidth < colWidth) {
                            currentLine.push(_.repeat(" ", colWidth - srcWidth));
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
                serializeToStringArray(source.source);
                const end = currentLocation();
                annotations.push({ annotation: source.annotation, span: { start, end } });
                break;
            case "name":
                assert(names.has(source.named), "No name for Named");
                indentIfNeeded();
                currentLine.push(defined(names.get(source.named)));
                break;
            case "modified":
                const serialized = serializeRenderResult({ rootSource: source.source, names }, indentation).lines;
                assert(serialized.length === 1, "Cannot modify more than one line.");
                currentLine.push(source.modifier(serialized[0]));
                break;
            default:
                return assertNever(source);
        }
    }

    serializeToStringArray(rootSource);
    finishLine();
    return { lines, annotations: List(annotations) };
}
