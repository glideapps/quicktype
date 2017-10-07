"use strict";

import { List, Map } from "immutable";

type GenericType<T> =
    | AnyType
    | NullType
    | BoolType
    | IntegerType
    | DoubleType
    | StringType
    | T;

type NativeTypes = ClassType | ArrayType | MapType | UnionType;
type GlueTypes = GlueClassType | GlueArrayType | GlueMapType | GlueUnionType;

type Type = GenericType<NativeTypes>;
type GlueType = GenericType<GlueTypes>;

interface GlueGraph {
    classes: GlueClassEntry[];
    toplevels: { [name: string]: GlueType };
}

// FIXME: OrderedMap?  We lose the order in PureScript right now, though.
type Graph = Map<string, Type>;

interface AnyType {
    kind: "any";
}

interface NullType {
    kind: "null";
}

interface BoolType {
    kind: "bool";
}

interface IntegerType {
    kind: "integer";
}

interface DoubleType {
    kind: "double";
}

interface StringType {
    kind: "string";
}

interface ArrayType {
    kind: "array";
    items: Type;
}

interface GlueArrayType {
    kind: "array";
    items: GlueType;
}

interface ClassType {
    kind: "class";
    properties: Map<string, Type>;
}

interface GlueClassType {
    kind: "class";
    index: number;
}

interface GlueClassEntry {
    properties: { [name: string]: GlueType };
}

interface MapType {
    kind: "map";
    values: Type;
}

interface GlueMapType {
    kind: "map";
    values: GlueType;
}

interface UnionType {
    kind: "union";
    // FIXME: ordered set?  Then we'd have to have classes
    // and implement hash and equals.
    members: List<Type>;
}

interface GlueUnionType {
    kind: "union";
    // FIXME: ordered set?  Then we'd have to have classes
    // and implement hash and equals.
    members: List<GlueType>;
}

function glueTypeToNative(type: GlueType, classes: Type[]): Type {
    switch (type.kind) {
        case "array": {
            const items = glueTypeToNative(type.items, classes);
            return { kind: "array", items };
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
            return { kind: "map", values };
        }
        case "union": {
            const members = type.members.map(t => glueTypeToNative(t, classes));
            return { kind: "union", members: List(members) };
        }
        default:
            return type;
    }
}

function glueTypesToNative(glueEntries: GlueClassEntry[]): Type[] {
    const classes: ClassType[] = [];
    for (const c of glueEntries) {
        if (c === null) {
            classes.push(null);
        } else {
            classes.push({ kind: "class", properties: Map() });
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
