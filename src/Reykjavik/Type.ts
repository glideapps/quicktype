"use strict";

import { OrderedSet, Map, Set } from "immutable";
import stringHash = require("string-hash");

export type PrimitiveKind =
    | "any"
    | "null"
    | "bool"
    | "integer"
    | "double"
    | "string";
type Kind = PrimitiveKind | "class" | "array" | "map" | "union";

type TypeNames = Set<string>;

// FIXME: OrderedMap?  We lose the order in PureScript right now, though,
// and maybe even earlier in the TypeScript driver.
export type Graph = Map<string, Type>;

export abstract class Type {
    abstract kind: Kind;

    constructor(kind: Kind) {
        this.kind = kind;
    }

    abstract equals(other: any): boolean;
    abstract hashCode(): number;
}

export class PrimitiveType extends Type {
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

export class ClassType extends Type {
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

export class ArrayType extends Type {
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

export class MapType extends Type {
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

export class UnionType extends Type {
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
