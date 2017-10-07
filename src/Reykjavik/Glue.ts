"use strict";

import { OrderedSet, Map, Set } from "immutable";
import {
    PrimitiveKind,
    Type,
    PrimitiveType,
    ClassType,
    ArrayType,
    MapType,
    UnionType,
    Graph
} from "./Type";

type GlueType =
    | GluePrimitiveType
    | GlueClassType
    | GlueArrayType
    | GlueMapType
    | GlueUnionType;

interface GlueGraph {
    classes: GlueClassEntry[];
    toplevels: { [name: string]: GlueType };
}

type GlueTypeNames = string[];

interface GluePrimitiveType {
    kind: PrimitiveKind;
}

interface GlueArrayType {
    kind: "array";
    items: GlueType;
}

interface GlueClassType {
    kind: "class";
    index: number;
}

interface GlueClassEntry {
    properties: { [name: string]: GlueType };
    names: GlueTypeNames;
}

interface GlueMapType {
    kind: "map";
    values: GlueType;
}

interface GlueUnionType {
    kind: "union";
    names: GlueTypeNames;
    members: GlueType[];
}

function glueTypeToNative(type: GlueType, classes: Type[]): Type {
    switch (type.kind) {
        case "array": {
            const items = glueTypeToNative(type.items, classes);
            return new ArrayType(items);
        }
        case "class": {
            const c = classes[type.index];
            if (c === null) {
                throw "Expected class is not in graph array";
            }
            return c;
        }
        case "map": {
            const values = glueTypeToNative(type.values, classes);
            return new MapType(values);
        }
        case "union": {
            const members = type.members.map(t => glueTypeToNative(t, classes));
            return new UnionType(Set(type.names), OrderedSet(members));
        }
        default:
            return new PrimitiveType(type.kind);
    }
}

function glueTypesToNative(glueEntries: GlueClassEntry[]): Type[] {
    const classes: ClassType[] = [];
    for (const c of glueEntries) {
        if (c === null) {
            classes.push(null);
        } else {
            classes.push(new ClassType(Set(c.names), Map()));
        }
    }

    for (let i = 0; i < classes.length; i++) {
        const c = classes[i];
        if (c === null) {
            continue;
        }
        const glueProperties = Map(glueEntries[i].properties);
        c.properties = glueProperties
            .map(t => glueTypeToNative(t, classes))
            .toMap();
    }

    return classes;
}

function glueGraphToNative(glueGraph: GlueGraph): Graph {
    const classes = glueTypesToNative(glueGraph.classes);
    return Map(glueGraph.toplevels)
        .map(t => glueTypeToNative(t, classes))
        .toMap();
}
