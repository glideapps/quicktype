"use strict";

import { OrderedSet, Map, Set, Iterable, List } from "immutable";
import stringHash = require("string-hash");
import { TypeKind, PrimitiveTypeKind, NamedTypeKind } from "Reykjavik";

export type TypeNames = {
    names: Set<string>;
    // FIXME: this is here until we have combineNames in TypeScript.
    combined: string;
};

// FIXME: OrderedMap?  We lose the order in PureScript right now, though,
// and maybe even earlier in the TypeScript driver.
// FIXME: Rename to TopLevels?
export type Graph = Map<string, Type>;

export abstract class Type {
    abstract kind: TypeKind;

    constructor(kind: TypeKind) {
        this.kind = kind;
    }

    abstract get children(): Set<Type>;

    abstract equals(other: any): boolean;
    abstract hashCode(): number;
}

export class PrimitiveType extends Type {
    kind: PrimitiveTypeKind;

    constructor(kind: PrimitiveTypeKind) {
        super(kind);
    }

    get children(): Set<Type> {
        return Set();
    }

    equals(other: any): boolean {
        if (!(other instanceof PrimitiveType)) return false;
        return this.kind === other.kind;
    }

    hashCode(): number {
        return stringHash(this.kind) | 0;
    }
}

export function isNull(t: Type): boolean {
    return t.kind === "null";
}

export class ArrayType extends Type {
    kind: "array";
    items: Type;

    constructor(items: Type) {
        super("array");
        this.items = items;
    }

    get children(): Set<Type> {
        return Set([this.items]);
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

    get children(): Set<Type> {
        return Set([this.values]);
    }

    equals(other: any): boolean {
        if (!(other instanceof MapType)) return false;
        return this.values.equals(other.values);
    }

    hashCode(): number {
        return (stringHash(this.kind) + this.values.hashCode()) | 0;
    }
}

export abstract class NamedType extends Type {
    names: TypeNames;

    constructor(kind: NamedTypeKind, names: TypeNames) {
        super(kind);
        this.names = names;
    }
}

export class ClassType extends NamedType {
    kind: "class";
    properties: Map<string, Type>;

    constructor(names: TypeNames, properties: Map<string, Type>) {
        super("class", names);
        this.names = names;
        this.properties = properties;
    }

    get children(): Set<Type> {
        return this.properties.toSet();
    }

    equals(other: any): boolean {
        if (!(other instanceof ClassType)) return false;
        return (
            this.names.names.equals(other.names.names) &&
            this.properties.equals(other.properties)
        );
    }

    hashCode(): number {
        return (
            (stringHash(this.kind) +
                this.names.names.hashCode() +
                this.properties.hashCode()) |
            0
        );
    }
}

export class UnionType extends NamedType {
    kind: "union";
    members: OrderedSet<Type>;

    constructor(names: TypeNames, members: OrderedSet<Type>) {
        super("union", names);
        this.names = names;
        this.members = members;
    }

    get children(): Set<Type> {
        return this.members.toSet();
    }

    equals(other: any): boolean {
        if (!(other instanceof UnionType)) return false;
        return (
            this.names.names.equals(other.names.names) &&
            this.members.equals(other.members)
        );
    }

    hashCode(): number {
        return (
            (stringHash(this.kind) +
                this.names.names.hashCode() +
                this.members.hashCode()) |
            0
        );
    }
}

function setUnion<T>(sets: Iterable<any, Set<T>>): Set<T> {
    const setArray = sets.toArray();
    if (setArray.length === 0) return OrderedSet();
    if (setArray.length === 1) return setArray[0];
    return setArray[0].union(...setArray.slice(1));
}

export type ClassesAndUnions = {
    classes: Set<ClassType>;
    unions: Set<UnionType>;
};

function combineClassesAndUnion(
    classesAndUnions: Iterable<any, ClassesAndUnions>
): ClassesAndUnions {
    let classes = setUnion(
        classesAndUnions.map((cau: ClassesAndUnions) => cau.classes)
    );
    let unions = setUnion(
        classesAndUnions.map((cau: ClassesAndUnions) => cau.unions)
    );
    return { classes, unions };
}

function classesAndUnionsInType(t: Type): ClassesAndUnions {
    let { classes, unions } = combineClassesAndUnion(
        t.children.map(classesAndUnionsInType)
    );
    if (t instanceof ClassType) {
        classes = classes.add(t);
    } else if (t instanceof UnionType) {
        unions = unions.add(t);
    }
    return { classes, unions };
}

export function allClassesAndUnions(graph: Graph): ClassesAndUnions {
    return combineClassesAndUnion(graph.map(classesAndUnionsInType));
}
