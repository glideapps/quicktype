"use strict";

import { List } from "immutable";

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
