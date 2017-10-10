"use strict";

import { List, Map } from "immutable";

import { Annotation } from "./Annotation";
import { Named } from "./Naming";

export type Source =
    | TextSource
    | NewlineSource
    | SequenceSource
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
    return { kind: "newline", indentationChange: 0 };
}

export type Sourcelike =
    | Source
    | string
    | Named
    | SourcelikeArray
    // FIXME: Do we need this?
    | (() => Sourcelike);
export interface SourcelikeArray extends Array<Sourcelike> {}

export function sourcelikeToSource(sl: Sourcelike): Source {
    if (sl instanceof Array) {
        return {
            kind: "sequence",
            sequence: List(sl.map(sourcelikeToSource))
        };
    }
    if (sl instanceof Function) {
        return sourcelikeToSource(sl());
    }
    if (typeof sl === "string") {
        // FIXME: newlines!
        return { kind: "text", text: sl };
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

export function serializeSource(
    source: Source,
    names: Map<Named, string>
): string {
    let indent = 0;

    function serializeToStringArray(
        source: Source,
        names: Map<Named, string>,
        array: string[]
    ): void {
        switch (source.kind) {
            case "text":
                array.push(source.text);
                break;
            case "newline":
                indent += source.indentationChange;
                array.push("\n" + "    ".repeat(indent));
                break;
            case "sequence":
                source.sequence.forEach((s: Source) =>
                    serializeToStringArray(s, names, array)
                );
                break;
            case "annotated":
                serializeToStringArray(source.source, names, array);
                break;
            case "name":
                if (!names.has(source.named)) {
                    throw "No name for Named";
                }
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
