"use strict";

import { OrderedSet, OrderedMap, Collection } from "immutable";
import { defined, panic, assert } from "./Support";
import { TypeRef, TypeBuilder } from "./TypeBuilder";

export type PrimitiveStringTypeKind = "string" | "date" | "time" | "date-time";
export type PrimitiveTypeKind = "any" | "null" | "bool" | "integer" | "double" | PrimitiveStringTypeKind;
export type NamedTypeKind = "class" | "enum" | "union";
export type TypeKind = PrimitiveTypeKind | NamedTypeKind | "array" | "map";

export abstract class Type {
    constructor(readonly typeRef: TypeRef, readonly kind: TypeKind) {}

    isNamedType(): this is NamedType {
        return false;
    }

    get isStringType(): boolean {
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

    get isStringType(): boolean {
        const kind = this.kind;
        return kind === "string" || kind === "date" || kind === "time" || kind === "date-time";
    }

    map(builder: TypeBuilder, _: (tref: TypeRef) => TypeRef): TypeRef {
        return builder.getPrimitiveType(this.kind);
    }
}

function isNull(t: Type): t is PrimitiveType {
    return t.kind === "null";
}

export class ArrayType extends Type {
    readonly kind: "array";

    constructor(typeRef: TypeRef, private _itemsRef?: TypeRef) {
        super(typeRef, "array");
    }

    setItems(itemsRef: TypeRef) {
        if (this._itemsRef !== undefined) {
            return panic("Can only set array items once");
        }
        this._itemsRef = itemsRef;
    }

    private getItemsRef(): TypeRef {
        if (this._itemsRef === undefined) {
            return panic("Array items accessed before they were set");
        }
        return this._itemsRef;
    }

    get items(): Type {
        return this.getItemsRef().deref();
    }

    get children(): OrderedSet<Type> {
        return OrderedSet([this.items]);
    }

    get isNullable(): boolean {
        return false;
    }

    map(builder: TypeBuilder, f: (tref: TypeRef) => TypeRef): TypeRef {
        return builder.getArrayType(f(this.getItemsRef()));
    }
}

export class MapType extends Type {
    readonly kind: "map";

    constructor(typeRef: TypeRef, private _valuesRef?: TypeRef) {
        super(typeRef, "map");
    }

    setValues(valuesRef: TypeRef) {
        if (this._valuesRef !== undefined) {
            return panic("Can only set map values once");
        }
        this._valuesRef = valuesRef;
    }

    private getValuesRef(): TypeRef {
        if (this._valuesRef === undefined) {
            return panic("Map values accessed before they were set");
        }
        return this._valuesRef;
    }

    get values(): Type {
        return this.getValuesRef().deref();
    }

    get children(): OrderedSet<Type> {
        return OrderedSet([this.values]);
    }

    get isNullable(): boolean {
        return false;
    }

    map(builder: TypeBuilder, f: (tref: TypeRef) => TypeRef): TypeRef {
        return builder.getMapType(f(this.getValuesRef()));
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

export type NamesWithAlternatives = { names: OrderedSet<string>; alternatives: OrderedSet<string> };
export type NameOrNames = string | OrderedSet<string> | NamesWithAlternatives;

function setFromNameOrNames(nameOrNames: NameOrNames): NamesWithAlternatives {
    if (typeof nameOrNames === "string") {
        return { names: OrderedSet([nameOrNames]), alternatives: OrderedSet() };
    } else if (OrderedSet.isOrderedSet(nameOrNames)) {
        return { names: nameOrNames as OrderedSet<string>, alternatives: OrderedSet() };
    } else {
        return nameOrNames as NamesWithAlternatives;
    }
}

export abstract class NamedType extends Type {
    private _names: OrderedSet<string>;
    private _areNamesInferred: boolean;
    private _alternativeNames: OrderedSet<string>;

    constructor(typeRef: TypeRef, kind: NamedTypeKind, nameOrNames: NameOrNames, areNamesInferred: boolean) {
        super(typeRef, kind);
        const { names, alternatives } = setFromNameOrNames(nameOrNames);
        this._names = names;
        this._areNamesInferred = areNamesInferred;
        this._alternativeNames = alternatives;
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

    get alternativeNames(): OrderedSet<string> {
        return this._alternativeNames;
    }

    addNames(nameOrNames: NameOrNames, isInferred: boolean): void {
        if (isInferred && !this._areNamesInferred) {
            return;
        }
        const { names, alternatives } = setFromNameOrNames(nameOrNames);
        if (this._areNamesInferred && !isInferred) {
            this._names = names;
            this._areNamesInferred = isInferred;
        } else {
            this._names = this._names.union(names);
        }
        this._alternativeNames = this._alternativeNames.union(alternatives);
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

    get proposedNames(): OrderedSet<string> {
        return OrderedSet([this.combinedName]).union(this._alternativeNames);
    }
}

export class ClassType extends NamedType {
    kind: "class";

    constructor(
        typeRef: TypeRef,
        names: NameOrNames,
        areNamesInferred: boolean,
        private _propertyRefs?: OrderedMap<string, TypeRef>
    ) {
        super(typeRef, "class", names, areNamesInferred);
    }

    setProperties(propertyRefs: OrderedMap<string, TypeRef>): void {
        if (this._propertyRefs !== undefined) {
            return panic("Can only set class properties once");
        }
        this._propertyRefs = propertyRefs;
    }

    private getPropertyRefs(): OrderedMap<string, TypeRef> {
        if (this._propertyRefs === undefined) {
            return panic("Class properties accessed before they were set");
        }
        return this._propertyRefs;
    }

    get properties(): OrderedMap<string, Type> {
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

    get isStringType(): boolean {
        return true;
    }

    map(builder: TypeBuilder, _: (tref: TypeRef) => TypeRef): TypeRef {
        return builder.getEnumType(this.names, this.areNamesInferred, this.cases);
    }
}

export class UnionType extends NamedType {
    kind: "union";

    constructor(
        typeRef: TypeRef,
        names: NameOrNames,
        areNamesInferred: boolean,
        private _memberRefs?: OrderedSet<TypeRef>
    ) {
        super(typeRef, "union", names, areNamesInferred);
        if (_memberRefs !== undefined) {
            assert(_memberRefs.size > 1, "Union has zero members");
        }
    }

    setMembers(memberRefs: OrderedSet<TypeRef>) {
        if (this._memberRefs !== undefined) {
            return panic("Can only set map members once");
        }
        assert(memberRefs.size > 1, "Union has zero members");
        this._memberRefs = memberRefs;
    }

    private getMemberRefs(): OrderedSet<TypeRef> {
        if (this._memberRefs === undefined) {
            return panic("Map members accessed before they were set");
        }
        return this._memberRefs;
    }

    get members(): OrderedSet<Type> {
        return this.getMemberRefs().map(tref => tref.deref());
    }

    get stringTypeMembers(): OrderedSet<Type> {
        return this.members.filter(t => t.isStringType);
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
        const members = this.getMemberRefs().map(f);
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

export function nonNullTypeCases(t: Type): OrderedSet<Type> {
    if (t.kind === "null") {
        return OrderedSet();
    }
    if (!(t instanceof UnionType)) {
        return OrderedSet([t]);
    }
    const nonNulls = removeNullFromUnion(t)[1];
    return OrderedSet(nonNulls);
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

export type StringTypeMatchers<U> = {
    dateType?: (dateType: PrimitiveType) => U;
    timeType?: (timeType: PrimitiveType) => U;
    dateTimeType?: (dateTimeType: PrimitiveType) => U;
};

export function matchTypeExhaustive<U>(
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
    unionType: (unionType: UnionType) => U,
    dateType: (dateType: PrimitiveType) => U,
    timeType: (timeType: PrimitiveType) => U,
    dateTimeType: (dateTimeType: PrimitiveType) => U
): U {
    if (t instanceof PrimitiveType) {
        const f = {
            any: anyType,
            null: nullType,
            bool: boolType,
            integer: integerType,
            double: doubleType,
            string: stringType,
            date: dateType,
            time: timeType,
            "date-time": dateTimeType
        }[t.kind];
        if (f) return f(t);
        return panic(`Unsupported PrimitiveType: ${t.kind}`);
    } else if (t instanceof ArrayType) return arrayType(t);
    else if (t instanceof ClassType) return classType(t);
    else if (t instanceof MapType) return mapType(t);
    else if (t instanceof EnumType) return enumType(t);
    else if (t instanceof UnionType) return unionType(t);
    return panic("Unknown Type");
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
    unionType: (unionType: UnionType) => U,
    stringTypeMatchers?: StringTypeMatchers<U>
): U {
    if (stringTypeMatchers === undefined) {
        stringTypeMatchers = {};
    }
    const typeNotSupported = (_: Type) => {
        return panic("Unsupported PrimitiveType");
    };
    return matchTypeExhaustive(
        t,
        anyType,
        nullType,
        boolType,
        integerType,
        doubleType,
        stringType,
        arrayType,
        classType,
        mapType,
        enumType,
        unionType,
        stringTypeMatchers.dateType || typeNotSupported,
        stringTypeMatchers.timeType || typeNotSupported,
        stringTypeMatchers.dateTimeType || typeNotSupported
    );
}
