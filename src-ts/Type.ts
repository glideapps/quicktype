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
export type TopLevels = Map<string, Type>;

export abstract class Type {
    constructor(readonly kind: TypeKind) {}

    isNamedType(): this is NamedType {
        return false;
    }

    abstract get children(): OrderedSet<Type>;

    get directlyReachableNamedTypes(): OrderedSet<NamedType> {
        if (this.isNamedType()) return OrderedSet([this]);
        return orderedSetUnion(this.children.map((t: Type) => t.directlyReachableNamedTypes));
    }

    abstract equals(other: any): boolean;
    abstract hashCode(): number;
}

export class PrimitiveType extends Type {
    readonly kind: PrimitiveTypeKind;

    constructor(kind: PrimitiveTypeKind) {
        super(kind);
    }

    get children(): OrderedSet<Type> {
        return OrderedSet();
    }

    equals(other: any): boolean {
        if (!(other instanceof PrimitiveType)) return false;
        return this.kind === other.kind;
    }

    hashCode(): number {
        return stringHash(this.kind) | 0;
    }
}

function isNull(t: Type): boolean {
    return t.kind === "null";
}

export class ArrayType extends Type {
    readonly kind: "array";

    constructor(readonly items: Type) {
        super("array");
    }

    get children(): OrderedSet<Type> {
        return OrderedSet([this.items]);
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
    readonly kind: "map";

    constructor(readonly values: Type) {
        super("map");
    }

    get children(): OrderedSet<Type> {
        return OrderedSet([this.values]);
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
    constructor(kind: NamedTypeKind, readonly names: TypeNames) {
        super(kind);
    }

    isNamedType(): this is NamedType {
        return true;
    }
}

export class ClassType extends NamedType {
    kind: "class";
    private _properties: Map<string, Type> | undefined;

    constructor(names: TypeNames) {
        super("class", names);
    }

    setProperties(properties: Map<string, Type>): void {
        if (this._properties !== undefined) {
            throw "Can only set class properties once";
        }
        this._properties = properties;
    }

    get properties(): Map<string, Type> {
        if (this._properties === undefined) {
            throw "Class properties accessed before they were set";
        }
        return this._properties;
    }

    get children(): OrderedSet<Type> {
        return this.properties.toOrderedSet();
    }

    equals(other: any): boolean {
        if (!(other instanceof ClassType)) return false;
        return (
            this.names.names.equals(other.names.names) && this.properties.equals(other.properties)
        );
    }

    hashCode(): number {
        return (
            (stringHash(this.kind) + this.names.names.hashCode() + this.properties.hashCode()) | 0
        );
    }
}

export class UnionType extends NamedType {
    kind: "union";

    constructor(names: TypeNames, readonly members: OrderedSet<Type>) {
        super("union", names);
    }

    findMember = (kind: TypeKind): Type | undefined => {
        return this.members.find((t: Type) => t.kind === kind);
    };

    get children(): OrderedSet<Type> {
        return this.members;
    }

    equals(other: any): boolean {
        if (!(other instanceof UnionType)) return false;
        return this.names.names.equals(other.names.names) && this.members.equals(other.members);
    }

    hashCode(): number {
        return (stringHash(this.kind) + this.names.names.hashCode() + this.members.hashCode()) | 0;
    }
}

export function removeNullFromUnion(t: UnionType): [boolean, OrderedSet<Type>] {
    if (!t.members.some(isNull)) {
        return [false, t.members];
    }
    return [true, t.members.filterNot(isNull).toOrderedSet()];
}

export function nullableFromUnion(t: UnionType): Type | null {
    const [hasNull, nonNulls] = removeNullFromUnion(t);
    if (!hasNull) return null;
    if (nonNulls.size !== 1) return null;
    return nonNulls.first();
}

function orderedSetUnion<T>(sets: Iterable<any, OrderedSet<T>>): OrderedSet<T> {
    const setArray = sets.toArray();
    if (setArray.length === 0) return OrderedSet();
    if (setArray.length === 1) return setArray[0];
    return setArray[0].union(...setArray.slice(1));
}

export type ClassesAndUnions = {
    classes: OrderedSet<ClassType>;
    unions: OrderedSet<UnionType>;
};

export function allClassesAndUnions(
    graph: TopLevels,
    childrenOfType?: (t: Type) => Iterable<any, Type>
): ClassesAndUnions {
    let classes = OrderedSet<ClassType>();
    let unions = OrderedSet<UnionType>();

    function addFromType(t: Type): void {
        if (t instanceof ClassType) {
            if (classes.has(t)) return;
            classes = classes.add(t);
        } else if (t instanceof UnionType) {
            if (unions.has(t)) return;
            unions = unions.add(t);
        }
        const children = childrenOfType ? childrenOfType(t) : t.children;
        children.forEach(addFromType);
    }

    graph.forEach(addFromType);
    return { classes, unions };
}

export function matchType<U>(
    primitiveType: (primitiveType: PrimitiveType) => U,
    arrayType: (arrayType: ArrayType) => U,
    classType: (classType: ClassType) => U,
    mapType: (mapType: MapType) => U,
    unionType: (unionType: UnionType) => U
): (t: Type) => U {
    return t => {
        if (t instanceof PrimitiveType) return primitiveType(t);
        else if (t instanceof ArrayType) return arrayType(t);
        else if (t instanceof ClassType) return classType(t);
        else if (t instanceof MapType) return mapType(t);
        else if (t instanceof UnionType) return unionType(t);
        throw "Unknown Type";
    };
}

export function matchPrimitiveType<U>(
    anyType: (anyType: PrimitiveType) => U,
    nullType: (nullType: PrimitiveType) => U,
    boolType: (boolType: PrimitiveType) => U,
    integerType: (integerType: PrimitiveType) => U,
    doubleType: (doubleType: PrimitiveType) => U,
    stringType: (stringType: PrimitiveType) => U
): (primitiveType: PrimitiveType) => U {
    return t => {
        const f = {
            any: anyType,
            null: nullType,
            bool: boolType,
            integer: integerType,
            double: doubleType,
            string: stringType
        }[t.kind];
        if (f) return f(t);
        throw `Unknown PrimitiveType: ${t.kind}`;
    };
}

export function matchTypeAll<U>(
    anyType: (anyType: PrimitiveType) => U,
    nullType: (nullType: PrimitiveType) => U,
    boolType: (boolType: PrimitiveType) => U,
    integerType: (integerType: PrimitiveType) => U,
    doubleType: (doubleType: PrimitiveType) => U,
    stringType: (stringType: PrimitiveType) => U,
    arrayType: (arrayType: ArrayType) => U,
    classType: (classType: ClassType) => U,
    mapType: (mapType: MapType) => U,
    unionType: (unionType: UnionType) => U
): (t: Type) => U {
    return matchType(
        matchPrimitiveType(anyType, nullType, boolType, integerType, doubleType, stringType),
        arrayType,
        classType,
        mapType,
        unionType
    );
}
