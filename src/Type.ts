"use strict";

import { OrderedSet, OrderedMap, Map, Set, Collection, List } from "immutable";
import { defined, panic, assert } from "./Support";
import { TypeGraph } from "./TypeGraph";
import { TypeGraphBuilder, TypeRef, TypeBuilder } from "./TypeBuilder";

export type PrimitiveTypeKind = "any" | "null" | "bool" | "integer" | "double" | "string";
export type NamedTypeKind = "class" | "enum" | "union";
export type TypeKind = PrimitiveTypeKind | NamedTypeKind | "array" | "map";

export abstract class Type {
    constructor(readonly typeRef: TypeRef, readonly kind: TypeKind) {}

    isNamedType(): this is NamedType {
        return false;
    }

    abstract get children(): OrderedSet<Type>;

    directlyReachableTypes<T>(setForType: (t: Type) => OrderedSet<T> | null): OrderedSet<T> {
        const set = setForType(this);
        if (set) return set;
        return orderedSetUnion(this.children.map((t: Type) => t.directlyReachableTypes(setForType)));
    }

    abstract get isNullable(): boolean;
    abstract map(builder: TypeBuilder, f: (tref: TypeRef) => TypeRef): TypeRef;

    equals(other: any): boolean {
        if (!Object.prototype.hasOwnProperty.call(other, "typeRef")) {
            return false;
        }
        return this.typeRef.equals(other.typeRef);
    }

    hashCode(): number {
        return this.typeRef.hashCode();
    }
}

export class PrimitiveType extends Type {
    readonly kind: PrimitiveTypeKind;

    constructor(typeRef: TypeRef, kind: PrimitiveTypeKind) {
        super(typeRef, kind);
    }

    get children(): OrderedSet<Type> {
        return OrderedSet();
    }

    get isNullable(): boolean {
        return this.kind === "null";
    }

    map(builder: TypeBuilder, f: (tref: TypeRef) => TypeRef): TypeRef {
        return builder.getPrimitiveType(this.kind);
    }
}

function isNull(t: Type): t is PrimitiveType {
    return t.kind === "null";
}

export class ArrayType extends Type {
    readonly kind: "array";

    constructor(typeRef: TypeRef, private readonly _itemsRef: TypeRef) {
        super(typeRef, "array");
    }

    get items(): Type {
        return this._itemsRef.deref();
    }

    get children(): OrderedSet<Type> {
        return OrderedSet([this.items]);
    }

    get isNullable(): boolean {
        return false;
    }

    map(builder: TypeBuilder, f: (tref: TypeRef) => TypeRef): TypeRef {
        return builder.getArrayType(f(this._itemsRef));
    }
}

export class MapType extends Type {
    readonly kind: "map";

    constructor(typeRef: TypeRef, private readonly _valuesRef: TypeRef) {
        super(typeRef, "map");
    }

    get values(): Type {
        return this._valuesRef.deref();
    }

    get children(): OrderedSet<Type> {
        return OrderedSet([this.values]);
    }

    get isNullable(): boolean {
        return false;
    }

    map(builder: TypeBuilder, f: (tref: TypeRef) => TypeRef): TypeRef {
        return builder.getMapType(f(this._valuesRef));
    }
}

// FIXME: In the case of overlapping prefixes and suffixes we will
// produce a name that includes the overlap twice.  For example, for
// the names "aaa" and "aaaa" we have the common prefix "aaa" and the
// common suffix "aaa", so we will produce the combined name "aaaaaa".
function combineNames(names: Collection<any, string>): string {
    const first = names.first();
    if (first === undefined) {
        return panic("Named type has no names");
    }
    if (names.count() === 1) {
        return first;
    }
    let prefixLength = first.length;
    let suffixLength = first.length;
    names.rest().forEach(n => {
        prefixLength = Math.min(prefixLength, n.length);
        for (let i = 0; i < prefixLength; i++) {
            if (first[i] !== n[i]) {
                prefixLength = i;
                break;
            }
        }

        suffixLength = Math.min(suffixLength, n.length);
        for (let i = 0; i < suffixLength; i++) {
            if (first[first.length - i - 1] !== n[n.length - i - 1]) {
                suffixLength = i;
                break;
            }
        }
    });
    const prefix = prefixLength > 2 ? first.substr(0, prefixLength) : "";
    const suffix = suffixLength > 2 ? first.substr(first.length - suffixLength) : "";
    const combined = prefix + suffix;
    if (combined.length > 2) {
        return combined;
    }
    return first;
}

export type NameOrNames = string | OrderedSet<string>;

function setFromNameOrNames(nameOrNames: NameOrNames): OrderedSet<string> {
    if (typeof nameOrNames === "string") {
        return OrderedSet([nameOrNames]);
    } else {
        return nameOrNames;
    }
}

export abstract class NamedType extends Type {
    private _names: OrderedSet<string>;
    private _areNamesInferred: boolean;

    constructor(typeRef: TypeRef, kind: NamedTypeKind, nameOrNames: NameOrNames, areNamesInferred: boolean) {
        super(typeRef, kind);
        this._names = setFromNameOrNames(nameOrNames);
        this._areNamesInferred = areNamesInferred;
    }

    isNamedType(): this is NamedType {
        return true;
    }

    get names(): OrderedSet<string> {
        return this._names;
    }

    get areNamesInferred(): boolean {
        return this._areNamesInferred;
    }

    addNames(nameOrNames: NameOrNames, isInferred: boolean): void {
        if (isInferred && !this._areNamesInferred) {
            return;
        }
        const names = setFromNameOrNames(nameOrNames);
        if (this._areNamesInferred && !isInferred) {
            this._names = names;
            this._areNamesInferred = isInferred;
        } else {
            this._names = this._names.union(names);
        }
    }

    /*
    setGivenName(name: string): void {
        this._names = OrderedSet([name]);
        this._areNamesInferred = false;
    }
    */

    get combinedName(): string {
        return combineNames(this._names);
    }
}

export class ClassType extends NamedType {
    kind: "class";

    constructor(
        typeRef: TypeRef,
        names: NameOrNames,
        areNamesInferred: boolean,
        private _propertyRefs?: Map<string, TypeRef>
    ) {
        super(typeRef, "class", names, areNamesInferred);
    }

    // FIXME: Get rid of this.  We use this for resolving recursive
    // types, where we create the class type first without properties,
    // then create the property types, which are now allowed to refer
    // to the class, and then we set the properties.  With the TypeBuilder
    // we have a much nicer solution to this, however.  We can just create
    // a forwarding entry without having to create the class itself.  This
    // also solves the problem of recursion when classes are not involved.
    // You could, for example, have a type `X = Map<string, X>`, which
    // right now we cannot resolve.
    setProperties(propertyRefs: Map<string, TypeRef>): void {
        if (this._propertyRefs !== undefined) {
            return panic("Can only set class properties once");
        }
        this._propertyRefs = propertyRefs;
    }

    private getPropertyRefs(): Map<string, TypeRef> {
        if (this._propertyRefs === undefined) {
            return panic("Class properties accessed before they were set");
        }
        return this._propertyRefs;
    }

    get properties(): Map<string, Type> {
        return this.getPropertyRefs().map(tref => tref.deref());
    }

    get sortedProperties(): OrderedMap<string, Type> {
        const properties = this.properties;
        const sortedKeys = properties.keySeq().sort();
        const props = sortedKeys.map((k: string): [string, Type] => [k, defined(properties.get(k))]);
        return OrderedMap(props);
    }

    get children(): OrderedSet<Type> {
        return this.sortedProperties.toOrderedSet();
    }

    get isNullable(): boolean {
        return false;
    }

    map(builder: TypeBuilder, f: (tref: TypeRef) => TypeRef): TypeRef {
        const properties = this.getPropertyRefs().map(f);
        return builder.getClassType(this.names, this.areNamesInferred, properties);
    }
}

export class EnumType extends NamedType {
    kind: "enum";

    constructor(typeRef: TypeRef, names: NameOrNames, areNamesInferred: boolean, readonly cases: OrderedSet<string>) {
        super(typeRef, "enum", names, areNamesInferred);
    }

    get children(): OrderedSet<Type> {
        return OrderedSet();
    }

    get isNullable(): boolean {
        return false;
    }

    map(builder: TypeBuilder, f: (tref: TypeRef) => TypeRef): TypeRef {
        return builder.getEnumType(this.names, this.areNamesInferred, this.cases);
    }
}

export class UnionType extends NamedType {
    kind: "union";

    constructor(
        typeRef: TypeRef,
        names: NameOrNames,
        areNamesInferred: boolean,
        private readonly _memberRefs: OrderedSet<TypeRef>
    ) {
        super(typeRef, "union", names, areNamesInferred);
        assert(_memberRefs.size > 1, "Union has zero members");
    }

    get members(): OrderedSet<Type> {
        return this._memberRefs.map(tref => tref.deref());
    }

    findMember = (kind: TypeKind): Type | undefined => {
        return this.members.find((t: Type) => t.kind === kind);
    };

    get children(): OrderedSet<Type> {
        return this.sortedMembers;
    }

    get isNullable(): boolean {
        return this.findMember("null") !== undefined;
    }

    map(builder: TypeBuilder, f: (tref: TypeRef) => TypeRef): TypeRef {
        const members = this._memberRefs.map(f);
        return builder.getUnionType(this.names, this.areNamesInferred, members);
    }

    get sortedMembers(): OrderedSet<Type> {
        // FIXME: We're assuming no two members of the same kind.
        return this.members.sortBy(t => t.kind);
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

export function nonNullTypeCases(t: Type): Set<Type> {
    if (t.kind === null) {
        return Set();
    }
    if (!(t instanceof UnionType)) {
        return Set([t]);
    }
    const [_, nonNulls] = removeNullFromUnion(t);
    return Set(nonNulls);
}

// FIXME: The outer OrderedSet should be some Collection, but I can't figure out
// which one.  Collection.Indexed doesn't work with OrderedSet, which is unfortunate.
function orderedSetUnion<T>(sets: OrderedSet<OrderedSet<T>>): OrderedSet<T> {
    const setArray = sets.toArray();
    if (setArray.length === 0) return OrderedSet();
    if (setArray.length === 1) return setArray[0];
    return setArray[0].union(...setArray.slice(1));
}

export type SeparatedNamedTypes = {
    classes: OrderedSet<ClassType>;
    enums: OrderedSet<EnumType>;
    unions: OrderedSet<UnionType>;
};

export function separateNamedTypes(types: Collection<any, NamedType>): SeparatedNamedTypes {
    const classes = types.filter((t: NamedType) => t instanceof ClassType).toOrderedSet() as OrderedSet<ClassType>;
    const enums = types.filter((t: NamedType) => t instanceof EnumType).toOrderedSet() as OrderedSet<EnumType>;
    const unions = types.filter((t: NamedType) => t instanceof UnionType).toOrderedSet() as OrderedSet<UnionType>;

    return { classes, enums, unions };
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
        return panic(`Unknown PrimitiveType: ${t.kind}`);
    } else if (t instanceof ArrayType) return arrayType(t);
    else if (t instanceof ClassType) return classType(t);
    else if (t instanceof MapType) return mapType(t);
    else if (t instanceof EnumType) return enumType(t);
    else if (t instanceof UnionType) return unionType(t);
    return panic("Unknown Type");
}
