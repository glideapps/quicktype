"use strict";

import { OrderedSet, Map, Set, Collection, List } from "immutable";
import stringHash = require("string-hash");
import { TypeKind, PrimitiveTypeKind, NamedTypeKind } from "Reykjavik";
import { defined } from "./Support";

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

    directlyReachableTypes<T>(setForType: (t: Type) => OrderedSet<T> | null): OrderedSet<T> {
        const set = setForType(this);
        if (set) return set;
        return orderedSetUnion(
            this.children.map((t: Type) => t.directlyReachableTypes(setForType))
        );
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

function isNull(t: Type): t is PrimitiveType {
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

export class EnumType extends NamedType {
    kind: "enum";

    constructor(names: TypeNames, readonly cases: OrderedSet<string>) {
        super("enum", names);
    }

    get children(): OrderedSet<Type> {
        return OrderedSet();
    }

    equals(other: any): boolean {
        if (!(other instanceof EnumType)) return false;
        return this.names.names.equals(other.names.names) && this.cases.equals(other.cases);
    }

    hashCode(): number {
        return (stringHash(this.kind) + this.names.names.hashCode() + this.cases.hashCode()) | 0;
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

export function removeNullFromUnion(t: UnionType): [PrimitiveType | null, OrderedSet<Type>] {
    const nullType = t.findMember("null");
    if (!nullType) {
        return [null, t.members];
    }
    return [nullType as PrimitiveType, t.members.filterNot(isNull).toOrderedSet()];
}

export function nullableFromUnion(t: UnionType): Type | null {
    const [hasNull, nonNulls] = removeNullFromUnion(t);
    if (!hasNull) return null;
    if (nonNulls.size !== 1) return null;
    return defined(nonNulls.first());
}

// FIXME: The outer OrderedSet should be some Collection, but I can't figure out
// which one.  Collection.Indexed doesn't work with OrderedSet, which is unfortunate.
function orderedSetUnion<T>(sets: OrderedSet<OrderedSet<T>>): OrderedSet<T> {
    const setArray = sets.toArray();
    if (setArray.length === 0) return OrderedSet();
    if (setArray.length === 1) return setArray[0];
    return setArray[0].union(...setArray.slice(1));
}

export function filterTypes<T extends Type>(
    predicate: (t: Type) => t is T,
    graph: TopLevels,
    childrenOfType?: (t: Type) => Collection<any, Type>
): OrderedSet<T> {
    let seen = Set<Type>();
    let types = List<T>();

    function addFromType(t: Type): void {
        if (seen.has(t)) return;
        seen = seen.add(t);

        const children = childrenOfType ? childrenOfType(t) : t.children;
        children.forEach(addFromType);
        if (predicate(t)) {
            types = types.push(t);
        }
    }

    graph.forEach(addFromType);
    return types.reverse().toOrderedSet();
}

export function allNamedTypes(
    graph: TopLevels,
    childrenOfType?: (t: Type) => Collection<any, Type>
): OrderedSet<NamedType> {
    return filterTypes<NamedType>(
        (t: Type): t is NamedType => t.isNamedType(),
        graph,
        childrenOfType
    );
}

export type SeparatedNamedTypes = {
    classes: OrderedSet<ClassType>;
    enums: OrderedSet<EnumType>;
    unions: OrderedSet<UnionType>;
};

export function separateNamedTypes(types: Collection<any, NamedType>): SeparatedNamedTypes {
    const classes = types
        .filter((t: NamedType) => t instanceof ClassType)
        .toOrderedSet() as OrderedSet<ClassType>;
    const enums = types
        .filter((t: NamedType) => t instanceof EnumType)
        .toOrderedSet() as OrderedSet<EnumType>;
    const unions = types
        .filter((t: NamedType) => t instanceof UnionType)
        .toOrderedSet() as OrderedSet<UnionType>;

    return { classes, enums, unions };
}

export function allNamedTypesSeparated(
    graph: TopLevels,
    childrenOfType?: (t: Type) => Collection<any, Type>
): SeparatedNamedTypes {
    const types = allNamedTypes(graph, childrenOfType);
    return separateNamedTypes(types);
}

export function matchType<U>(
    t: Type,
    anyType: (anyType: PrimitiveType) => U,
    nullType: (nullType: PrimitiveType) => U,
    boolType: (boolType: PrimitiveType) => U,
    integerType: (integerType: PrimitiveType) => U,
    doubleType: (doubleType: PrimitiveType) => U,
    stringType: (stringType: PrimitiveType) => U,
    arrayType: (arrayType: ArrayType) => U,
    classType: (classType: ClassType) => U,
    mapType: (mapType: MapType) => U,
    enumType: (enumType: EnumType) => U,
    unionType: (unionType: UnionType) => U
): U {
    if (t instanceof PrimitiveType) {
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
    } else if (t instanceof ArrayType) return arrayType(t);
    else if (t instanceof ClassType) return classType(t);
    else if (t instanceof MapType) return mapType(t);
    else if (t instanceof EnumType) return enumType(t);
    else if (t instanceof UnionType) return unionType(t);
    throw "Unknown Type";
}
