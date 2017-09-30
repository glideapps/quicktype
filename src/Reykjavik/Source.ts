"use strict";

import { List, Map } from "immutable";

import { Annotation } from "./Annotation";
import { Named } from "./Naming";

type Source =
    | TextSource
    | NewlineSource
    | SequenceSource
    | AnnotatedSource
    | NameSource;

interface TextSource {
    kind: "text";
    text: string;
}

interface NewlineSource {
    kind: "newline";
}

interface SequenceSource {
    kind: "sequence";
    sequence: List<Source>;
}

interface AnnotatedSource {
    kind: "annotated";
    annotation: Annotation;
    source: Source;
}

interface NameSource {
    kind: "name";
    named: Named;
}

type Sourcelike =
    | Source
    | string
    | Named
    | SourcelikeArray
    | (() => Sourcelike);
interface SourcelikeArray extends Array<Sourcelike> {}

function sourcelikeToSource(sl: Sourcelike): Source {
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
            array.push("\n");
            break;
        case "sequence":
            source.sequence.forEach(s =>
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

function serializeSource(source: Source, names: Map<Named, string>): string {
    const array: string[] = [];
    serializeToStringArray(source, names, array);
    return array.join("");
}
