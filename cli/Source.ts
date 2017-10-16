"use strict";

import { List, Map } from "immutable";

import { Annotation } from "./Annotation";
import { Named } from "./Naming";
import { intercalate } from "./Utils";

export type Source = TextSource | NewlineSource | SequenceSource | AnnotatedSource | NameSource;

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

export interface AnnotatedSource {
    kind: "annotated";
    annotation: Annotation;
    source: Source;
}

export interface NameSource {
    kind: "name";
    named: Named;
}

export function newline(): NewlineSource {
    // FIXME: use singleton?
    return { kind: "newline", indentationChange: 0 };
}

export type Sourcelike = Source | string | Named | SourcelikeArray;
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
    if (sl instanceof Named) {
        return { kind: "name", named: sl };
    }
    return sl;
}

function annotated(annotation: Annotation, sl: Sourcelike): Source {
    return {
        kind: "annotated",
        annotation,
        source: sourcelikeToSource(sl)
    };
}

function assertNever(x: never): never {
    throw new Error("Unexpected object: " + x);
}

export function serializeSource(source: Source, names: Map<Named, string>): string {
    let indent = 0;
    let indentNeeded = 0;

    function indentIfNeeded(): void {
        if (indentNeeded === 0) return;
        array.push("    ".repeat(indentNeeded));
        indentNeeded = 0;
    }

    function serializeToStringArray(
        source: Source,
        names: Map<Named, string>,
        array: string[]
    ): void {
        switch (source.kind) {
            case "text":
                indentIfNeeded();
                array.push(source.text);
                break;
            case "newline":
                array.push("\n");
                indent += source.indentationChange;
                indentNeeded = indent;
                break;
            case "sequence":
                source.sequence.forEach((s: Source) => serializeToStringArray(s, names, array));
                break;
            case "annotated":
                serializeToStringArray(source.source, names, array);
                break;
            case "name":
                if (!names.has(source.named)) {
                    throw "No name for Named";
                }
                indentIfNeeded();
                array.push(names.get(source.named));
                break;
            default:
                return assertNever(source);
        }
    }

    const array: string[] = [];
    serializeToStringArray(source, names, array);
    return array.join("");
}
