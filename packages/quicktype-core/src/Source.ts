import { arrayIntercalate, iterableMax, withDefault } from "collection-utils";

import { type AnnotationData } from "./Annotation";
import { Name } from "./Naming";
import { defined, assertNever, panic, assert } from "./support/Support";
import { repeatString } from "./support/Strings";

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
    // Number of indentation levels (not spaces!) to change
// the rest of the source by.  Positive numbers mean
// indent more, negative mean indent less.  The most
// common value will be zero, for no change in
// indentation.
    indentationChange: number;
    kind: "newline";
}

export interface SequenceSource {
    kind: "sequence";
    sequence: readonly Source[];
}

export interface TableSource {
    kind: "table";
    table: ReadonlyArray<readonly Source[]>;
}

export interface AnnotatedSource {
    annotation: AnnotationData;
    kind: "annotated";
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

export function newline (): NewlineSource {
    // We're returning a new object instead of using a singleton
    // here because `Renderer` will modify `indentationChange`.
    return { kind: "newline", indentationChange: 0 };
}

export type Sourcelike = Source | string | Name | SourcelikeArray;
export type SourcelikeArray = Sourcelike[];

export function sourcelikeToSource (sl: Sourcelike): Source {
    if (sl instanceof Array) {
        return {
            kind: "sequence",
            sequence: sl.map(sourcelikeToSource),
        };
    }

    if (typeof sl === "string") {
        const lines = sl.split("\n");
        if (lines.length === 1) {
            return { kind: "text", text: sl };
        }

        return {
            kind: "sequence",
            sequence: arrayIntercalate(
                newline(),
                lines.map((l: string) => ({ kind: "text", text: l } as Source)),
            ),
        };
    }

    if (sl instanceof Name) {
        return { kind: "name", named: sl };
    }

    return sl;
}

export function annotated (annotation: AnnotationData, sl: Sourcelike): Source {
    return {
        kind: "annotated",
        annotation,
        source: sourcelikeToSource(sl),
    };
}

export function maybeAnnotated (doAnnotate: boolean, annotation: AnnotationData, sl: Sourcelike): Sourcelike {
    if (!doAnnotate) {
        return sl;
    }

    return annotated(annotation, sl);
}

export function modifySource (modifier: (serialized: string) => string, sl: Sourcelike): Sourcelike {
    return {
        kind: "modified",
        modifier,
        source: sourcelikeToSource(sl),
    };
}

export interface Location {
    column: number;
    // Both of these are zero-based.
    line: number;
}

export interface Span {
    end: Location;
    start: Location;
}

export interface Annotation {
    annotation: AnnotationData;
    span: Span;
}

export interface SerializedRenderResult {
    annotations: readonly Annotation[];
    lines: string[];
}

function sourceLineLength (source: Source, names: ReadonlyMap<Name, string>): number {
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
            return serializeRenderResult(source, names, "").lines.join("\n").length;
        default:
            return assertNever(source);
    }
}

export function serializeRenderResult (
    rootSource: Source,
    names: ReadonlyMap<Name, string>,
    indentation: string,
): SerializedRenderResult {
    let indent = 0;
    let indentNeeded = 0;

    const lines: string[] = [];
    let currentLine: string[] = [];
    const annotations: Annotation[] = [];

    function indentIfNeeded (): void {
        if (indentNeeded === 0) return;
        currentLine.push(repeatString(indentation, indentNeeded));
        indentNeeded = 0;
    }

    function flattenCurrentLine (): string {
        const str = currentLine.join("");
        currentLine = [str];
        return str;
    }

    function currentLocation (): Location {
        return { line: lines.length, column: flattenCurrentLine().length };
    }

    function finishLine (): void {
        lines.push(flattenCurrentLine());
        currentLine = [];
    }

    function serializeToStringArray (source: Source): void {
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
                for (const s of source.sequence) {
                    serializeToStringArray(s);
                }

                break;
            case "table":
                const t = source.table;
                const numRows = t.length;
                if (numRows === 0) break;
                const widths = t.map(l => l.map(s => sourceLineLength(s, names)));
                const numColumns = defined(iterableMax(t.map(l => l.length)));
                if (numColumns === 0) break;
                const columnWidths: number[] = [];
                for (let i = 0; i < numColumns; i++) {
                    columnWidths.push(defined(iterableMax(widths.map(l => withDefault<number>(l[i], 0)))));
                }

                for (let y = 0; y < numRows; y++) {
                    indentIfNeeded();
                    const row = defined(t[y]);
                    const rowWidths = defined(widths[y]);
                    for (let x = 0; x < numColumns; x++) {
                        const colWidth = columnWidths[x];
                        const src = withDefault<Source>(row[x], { kind: "text", text: "" });
                        const srcWidth = withDefault<number>(rowWidths[x], 0);
                        serializeToStringArray(src);
                        if (x < numColumns - 1 && srcWidth < colWidth) {
                            currentLine.push(repeatString(" ", colWidth - srcWidth));
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
                indentIfNeeded();
                const serialized = serializeRenderResult(source.source, names, indentation).lines;
                assert(serialized.length === 1, "Cannot modify more than one line.");
                currentLine.push(source.modifier(serialized[0]));
                break;
            default:
                return assertNever(source);
        }
    }

    serializeToStringArray(rootSource);
    finishLine();
    return { lines, annotations: annotations };
}

export interface MultiWord {
    needsParens: boolean;
    source: Sourcelike;
}

export function singleWord (...source: Sourcelike[]): MultiWord {
    return { source, needsParens: false };
}

export function multiWord (separator: Sourcelike, ...words: Sourcelike[]): MultiWord {
    assert(words.length > 0, "Zero words is not multiple");
    if (words.length === 1) {
        return singleWord(words[0]);
    }

    const items: Sourcelike[] = [];
    for (let i = 0; i < words.length; i++) {
        if (i > 0) items.push(separator);
        items.push(words[i]);
    }

    return { source: items, needsParens: true };
}

export function parenIfNeeded ({ source, needsParens }: MultiWord): Sourcelike {
    if (needsParens) {
        return ["(", source, ")"];
    }

    return source;
}
