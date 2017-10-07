"use strict";

import { OrderedSet, Map, Set } from "immutable";
import stringHash = require("string-hash");

type PrimitiveKind = "any" | "null" | "bool" | "integer" | "double" | "string";
type Kind = PrimitiveKind | "class" | "array" | "map" | "union";

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

type TypeNames = Set<string>;
type GlueTypeNames = string[];

// FIXME: OrderedMap?  We lose the order in PureScript right now, though,
// and maybe even earlier in the TypeScript driver.
type Graph = Map<string, Type>;

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

abstract class Type {
    abstract kind: Kind;

    constructor(kind: Kind) {
        this.kind = kind;
    }

    abstract equals(other: any): boolean;
    abstract hashCode(): number;
}

class PrimitiveType extends Type {
    kind: PrimitiveKind;

    constructor(kind: PrimitiveKind) {
        super(kind);
    }

    equals(other: any): boolean {
        if (!(other instanceof PrimitiveType)) return false;
        return this.kind === other.kind;
    }

    hashCode(): number {
        return stringHash(this.kind) | 0;
    }
}

class ClassType extends Type {
    kind: "class";
    names: TypeNames;
    properties: Map<string, Type>;

    constructor(names: TypeNames, properties: Map<string, Type>) {
        super("class");
        this.names = names;
        this.properties = properties;
    }

    equals(other: any): boolean {
        if (!(other instanceof ClassType)) return false;
        return (
            this.names.equals(other.names) &&
            this.properties.equals(other.properties)
        );
    }

    hashCode(): number {
        return (
            (stringHash(this.kind) +
                this.names.hashCode() +
                this.properties.hashCode()) |
            0
        );
    }
}

class ArrayType extends Type {
    kind: "array";
    items: Type;

    constructor(items: Type) {
        super("array");
        this.items = items;
    }

    equals(other: any): boolean {
        if (!(other instanceof ArrayType)) return false;
        return this.items.equals(other.items);
    }

    hashCode(): number {
        return (stringHash(this.kind) + this.items.hashCode()) | 0;
    }
}

class MapType extends Type {
    kind: "map";
    values: Type;

    constructor(values: Type) {
        super("map");
        this.values = values;
    }

    equals(other: any): boolean {
        if (!(other instanceof MapType)) return false;
        return this.values.equals(other.values);
    }

    hashCode(): number {
        return (stringHash(this.kind) + this.values.hashCode()) | 0;
    }
}

class UnionType extends Type {
    kind: "union";
    names: TypeNames;
    members: OrderedSet<Type>;

    constructor(names: TypeNames, members: OrderedSet<Type>) {
        super("union");
        this.names = names;
        this.members = members;
    }

    equals(other: any): boolean {
        if (!(other instanceof UnionType)) return false;
        return (
            this.names.equals(other.names) && this.members.equals(other.members)
        );
    }

    hashCode(): number {
        return (
            (stringHash(this.kind) +
                this.names.hashCode() +
                this.members.hashCode()) |
            0
        );
    }
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
