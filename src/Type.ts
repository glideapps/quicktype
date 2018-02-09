"use strict";

import { OrderedSet, OrderedMap, Collection } from "immutable";

import { defined, panic, assert, assertNever } from "./Support";
import { TypeRef, TypeReconstituter } from "./TypeBuilder";
import { TypeNames } from "./TypeNames";
import { TypeAttributes, namesTypeAttributeKind } from "./TypeGraph";

export type PrimitiveStringTypeKind = "string" | "date" | "time" | "date-time";
export type PrimitiveTypeKind = "none" | "any" | "null" | "bool" | "integer" | "double" | PrimitiveStringTypeKind;
export type NamedTypeKind = "class" | "enum" | "union";
export type TypeKind = PrimitiveTypeKind | NamedTypeKind | "array" | "map";

function triviallyStructurallyCompatible(x: Type, y: Type): boolean {
    if (x.typeRef.getIndex() === y.typeRef.getIndex()) return true;
    if (x.kind === "none" || y.kind === "none") return true;
    return false;
}

/*
const mapPath: string[] = ["#"];
function mapIndentation(): string {
    return "  ".repeat(mapPath.length);
}
*/

export abstract class Type {
    constructor(readonly typeRef: TypeRef, readonly kind: TypeKind) {}

    abstract get children(): OrderedSet<Type>;

    directlyReachableTypes<T>(setForType: (t: Type) => OrderedSet<T> | null): OrderedSet<T> {
        const set = setForType(this);
        if (set) return set;
        return orderedSetUnion(this.children.map((t: Type) => t.directlyReachableTypes(setForType)));
    }

    getAttributes(): TypeAttributes {
        return this.typeRef.deref()[1];
    }

    get hasNames(): boolean {
        return namesTypeAttributeKind.tryGetInAttributes(this.getAttributes()) !== undefined;
    }

    getNames(): TypeNames {
        return defined(namesTypeAttributeKind.tryGetInAttributes(this.getAttributes()));
    }

    getCombinedName(): string {
        return this.getNames().combinedName;
    }

    getProposedNames(): OrderedSet<string> {
        return this.getNames().proposedNames;
    }

    abstract get isNullable(): boolean;
    abstract isPrimitive(): this is PrimitiveType;
    abstract map(builder: TypeReconstituter, f: (tref: TypeRef) => TypeRef): TypeRef;

    equals(other: any): boolean {
        if (!Object.prototype.hasOwnProperty.call(other, "typeRef")) {
            return false;
        }
        return this.typeRef.equals(other.typeRef);
    }

    hashCode(): number {
        return this.typeRef.hashCode();
    }

    // This will only ever be called when `this` and `other` are not
    // equal, but `this.kind === other.kind`.
    protected abstract structuralEqualityStep(other: Type, queue: (a: Type, b: Type) => boolean): boolean;

    structurallyCompatible(other: Type): boolean {
        if (triviallyStructurallyCompatible(this, other)) return true;
        if (this.kind !== other.kind) return false;

        const workList: [Type, Type][] = [[this, other]];
        // This contains a set of pairs which are the type pairs
        // we have already determined to be equal.  We can't just
        // do comparison recursively because types can have cycles.
        const done: [number, number][] = [];

        let failed: boolean;
        const queue = (x: Type, y: Type): boolean => {
            if (triviallyStructurallyCompatible(x, y)) return true;
            if (x.kind !== y.kind) {
                failed = true;
                return false;
            }
            workList.push([x, y]);
            return true;
        };

        while (workList.length > 0) {
            let [a, b] = defined(workList.pop());
            if (a.typeRef.getIndex() > b.typeRef.getIndex()) {
                [a, b] = [b, a];
            }

            if (!a.isPrimitive()) {
                let ai = a.typeRef.getIndex();
                let bi = b.typeRef.getIndex();

                let found = false;
                for (const [dai, dbi] of done) {
                    if (dai === ai && dbi === bi) {
                        found = true;
                        break;
                    }
                }
                if (found) continue;
                done.push([ai, bi]);
            }

            failed = false;
            if (!a.structuralEqualityStep(b, queue)) return false;
            if (failed) return false;
        }

        return true;
    }
}

export class PrimitiveType extends Type {
    readonly kind: PrimitiveTypeKind;

    constructor(typeRef: TypeRef, kind: PrimitiveTypeKind, checkKind: boolean = true) {
        if (checkKind) {
            assert(kind !== "string", "Cannot instantiate a PrimitiveType as string");
        }
        super(typeRef, kind);
    }

    get children(): OrderedSet<Type> {
        return OrderedSet();
    }

    get isNullable(): boolean {
        return this.kind === "null" || this.kind === "any" || this.kind === "none";
    }

    isPrimitive(): this is PrimitiveType {
        return true;
    }

    map(builder: TypeReconstituter, _: (tref: TypeRef) => TypeRef): TypeRef {
        // console.log(`${mapIndentation()}mapping ${this.kind}`);
        return builder.getPrimitiveType(this.kind);
    }

    protected structuralEqualityStep(_other: Type, _queue: (a: Type, b: Type) => boolean): boolean {
        return true;
    }
}

function isNull(t: Type): t is PrimitiveType {
    return t.kind === "null";
}

export class StringType extends PrimitiveType {
    constructor(typeRef: TypeRef, readonly enumCases: OrderedMap<string, number> | undefined) {
        super(typeRef, "string", false);
    }

    map(builder: TypeReconstituter, _: (tref: TypeRef) => TypeRef): TypeRef {
        // console.log(`${mapIndentation()}mapping ${this.kind}`);
        return builder.getStringType(this.enumCases);
    }

    protected structuralEqualityStep(_other: Type, _queue: (a: Type, b: Type) => boolean): boolean {
        return true;
    }
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
        return this.getItemsRef().deref()[0];
    }

    get children(): OrderedSet<Type> {
        return OrderedSet([this.items]);
    }

    get isNullable(): boolean {
        return false;
    }

    isPrimitive(): this is PrimitiveType {
        return false;
    }

    map(builder: TypeReconstituter, f: (tref: TypeRef) => TypeRef): TypeRef {
        // console.log(`${mapIndentation()}mapping ${this.kind}`);
        // mapPath.push("[]");
        const result = builder.getArrayType(f(this.getItemsRef()));
        // mapPath.pop();
        return result;
    }

    protected structuralEqualityStep(other: ArrayType, queue: (a: Type, b: Type) => boolean): boolean {
        return queue(this.items, other.items);
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
        return this.getValuesRef().deref()[0];
    }

    get children(): OrderedSet<Type> {
        return OrderedSet([this.values]);
    }

    get isNullable(): boolean {
        return false;
    }

    isPrimitive(): this is PrimitiveType {
        return false;
    }

    map(builder: TypeReconstituter, f: (tref: TypeRef) => TypeRef): TypeRef {
        // console.log(`${mapIndentation()}mapping ${this.kind}`);
        // mapPath.push("{}");
        const result = builder.getMapType(f(this.getValuesRef()));
        // mapPath.pop();
        return result;
    }

    protected structuralEqualityStep(other: MapType, queue: (a: Type, b: Type) => boolean): boolean {
        return queue(this.values, other.values);
    }
}

export class ClassProperty {
    constructor(readonly typeRef: TypeRef, readonly isOptional: boolean) {}

    get type(): Type {
        return this.typeRef.deref()[0];
    }

    equals(other: any): boolean {
        if (!(other instanceof ClassProperty)) {
            return false;
        }
        return this.typeRef.equals(other.typeRef) && this.isOptional === other.isOptional;
    }

    hashCode(): number {
        return this.typeRef.hashCode() + (this.isOptional ? 17 : 23);
    }
}

function propertiesAreSorted(_props: OrderedMap<string, ClassProperty>): boolean {
    /*
    const keys = props.keySeq().toArray();
    for (let i = 1; i < keys.length; i++) {
        if (keys[i - 1] > keys[i]) return false;
    }
*/
    return true;
}

export class ClassType extends Type {
    kind: "class";

    constructor(typeRef: TypeRef, readonly isFixed: boolean, private _properties?: OrderedMap<string, ClassProperty>) {
        super(typeRef, "class");
        if (_properties !== undefined) {
            assert(propertiesAreSorted(_properties));
        }
    }

    setProperties(properties: OrderedMap<string, ClassProperty>): void {
        assert(propertiesAreSorted(properties));
        if (this._properties !== undefined) {
            return panic("Can only set class properties once");
        }
        this._properties = properties;
    }

    get properties(): OrderedMap<string, ClassProperty> {
        if (this._properties === undefined) {
            return panic("Properties are not set yet");
        }
        return this._properties;
    }

    get sortedProperties(): OrderedMap<string, ClassProperty> {
        const properties = this.properties;
        const sortedKeys = properties.keySeq().sort();
        const props = sortedKeys.map((k: string): [string, ClassProperty] => [k, defined(properties.get(k))]);
        return OrderedMap(props);
    }

    get children(): OrderedSet<Type> {
        return this.sortedProperties.map(p => p.type).toOrderedSet();
    }

    get isNullable(): boolean {
        return false;
    }

    isPrimitive(): this is PrimitiveType {
        return false;
    }

    map(builder: TypeReconstituter, f: (tref: TypeRef) => TypeRef): TypeRef {
        // const indent = "  ".repeat(mapPath.length);
        // const path = mapPath.join(".");
        // console.log(`${indent} mapping class ${this.getCombinedName()} at ${path}`);
        const properties = this.properties.map((p, _n) => {
            // console.log(`${indent}  property ${path}.${n}`);
            // mapPath.push(n);
            const result = new ClassProperty(f(p.typeRef), p.isOptional);
            // mapPath.pop();
            return result;
        });
        if (this.isFixed) {
            return builder.getUniqueClassType(true, properties);
        } else {
            return builder.getClassType(properties);
        }
    }

    protected structuralEqualityStep(other: ClassType, queue: (a: Type, b: Type) => boolean): boolean {
        const pa = this.properties;
        const pb = other.properties;
        if (pa.size !== pb.size) return false;
        let failed = false;
        pa.forEach((cpa, name) => {
            const cpb = pb.get(name);
            if (cpb === undefined || cpa.isOptional !== cpb.isOptional || !queue(cpa.type, cpb.type)) {
                failed = true;
                return false;
            }
        });
        return !failed;
    }
}

export function assertIsClass(t: Type): ClassType {
    if (!(t instanceof ClassType)) {
        return panic("Supposed class type is not a class type");
    }
    return t;
}

export class EnumType extends Type {
    kind: "enum";

    constructor(typeRef: TypeRef, readonly cases: OrderedSet<string>) {
        super(typeRef, "enum");
    }

    get children(): OrderedSet<Type> {
        return OrderedSet();
    }

    get isNullable(): boolean {
        return false;
    }

    isPrimitive(): this is PrimitiveType {
        return false;
    }

    map(builder: TypeReconstituter, _: (tref: TypeRef) => TypeRef): TypeRef {
        // console.log(`${mapIndentation()}mapping ${this.kind}`);
        return builder.getEnumType(this.cases);
    }

    protected structuralEqualityStep(other: EnumType, _queue: (a: Type, b: Type) => void): boolean {
        return this.cases.toSet().equals(other.cases.toSet());
    }
}

export class UnionType extends Type {
    kind: "union";

    constructor(typeRef: TypeRef, private _memberRefs?: OrderedSet<TypeRef>) {
        super(typeRef, "union");
        if (_memberRefs !== undefined) {
            assert(_memberRefs.size > 1, "Union less than two members");
        }
    }

    setMembers(memberRefs: OrderedSet<TypeRef>) {
        if (this._memberRefs !== undefined) {
            return panic("Can only set map members once");
        }
        assert(memberRefs.size > 1, "Union less than two members");
        this._memberRefs = memberRefs;
    }

    private getMemberRefs(): OrderedSet<TypeRef> {
        if (this._memberRefs === undefined) {
            return panic("Map members accessed before they were set");
        }
        return this._memberRefs;
    }

    get members(): OrderedSet<Type> {
        return this.getMemberRefs().map(tref => tref.deref()[0]);
    }

    get stringTypeMembers(): OrderedSet<Type> {
        return this.members.filter(t => ["string", "date", "time", "date-time", "enum"].indexOf(t.kind) >= 0);
    }

    findMember(kind: TypeKind): Type | undefined {
        return this.members.find((t: Type) => t.kind === kind);
    }

    get children(): OrderedSet<Type> {
        return this.sortedMembers;
    }

    get isNullable(): boolean {
        return this.findMember("null") !== undefined;
    }

    isPrimitive(): this is PrimitiveType {
        return false;
    }

    map(builder: TypeReconstituter, f: (tref: TypeRef) => TypeRef): TypeRef {
        // console.log(`${mapIndentation()}mapping union ${this.getCombinedName()}`);
        const members = this.getMemberRefs().map(t => {
            // const kind = t.deref()[0].kind;
            // console.log(`${mapIndentation()}  member ${kind}`);
            // mapPath.push(kind);
            const result = f(t);
            // mapPath.pop();
            return result;
        });
        return builder.getUnionType(members);
    }

    get sortedMembers(): OrderedSet<Type> {
        // FIXME: We're assuming no two members of the same kind.
        return this.members.sortBy(t => t.kind);
    }

    protected structuralEqualityStep(other: UnionType, queue: (a: Type, b: Type) => boolean): boolean {
        return unionCasesEqual(this.members, other.members, queue);
    }
}

export function unionCasesEqual(
    ma: OrderedSet<Type>,
    mb: OrderedSet<Type>,
    membersEqual: (a: Type, b: Type) => boolean
): boolean {
    if (ma.size !== mb.size) return false;
    let failed = false;
    ma.forEach(ta => {
        const tb = mb.find(t => t.kind === ta.kind);
        if (tb === undefined || !membersEqual(ta, tb)) {
            failed = true;
            return false;
        }
    });
    return !failed;
}

export function allTypeCases(t: Type): OrderedSet<Type> {
    if (t instanceof UnionType) {
        return t.members;
    }
    return OrderedSet([t]);
}

export function removeNullFromUnion(t: UnionType): [PrimitiveType | null, OrderedSet<Type>] {
    const nullType = t.findMember("null");
    if (nullType === undefined) {
        return [null, t.members];
    }
    return [nullType as PrimitiveType, t.members.filterNot(isNull).toOrderedSet()];
}

export function removeNullFromType(t: Type): [PrimitiveType | null, OrderedSet<Type>] {
    if (t.kind === "null") {
        return [t as PrimitiveType, OrderedSet()];
    }
    if (!(t instanceof UnionType)) {
        return [null, OrderedSet([t])];
    }
    return removeNullFromUnion(t);
}

export function nullableFromUnion(t: UnionType): Type | null {
    const [hasNull, nonNulls] = removeNullFromUnion(t);
    if (hasNull === null) return null;
    if (nonNulls.size !== 1) return null;
    return defined(nonNulls.first());
}

export function nonNullTypeCases(t: Type): OrderedSet<Type> {
    return removeNullFromType(t)[1];
}

export function getNullAsOptional(cp: ClassProperty): [boolean, OrderedSet<Type>] {
    const [maybeNull, nonNulls] = removeNullFromType(cp.type);
    if (cp.isOptional) {
        return [true, nonNulls];
    }
    return [maybeNull !== null, nonNulls];
}

// FIXME: The outer OrderedSet should be some Collection, but I can't figure out
// which one.  Collection.Indexed doesn't work with OrderedSet, which is unfortunate.
function orderedSetUnion<T>(sets: OrderedSet<OrderedSet<T>>): OrderedSet<T> {
    const setArray = sets.toArray();
    if (setArray.length === 0) return OrderedSet();
    if (setArray.length === 1) return setArray[0];
    return setArray[0].union(...setArray.slice(1));
}

// FIXME: Give this an appropriate name, considering that we don't distinguish
// between named and non-named types anymore.
export function isNamedType(t: Type): boolean {
    return t instanceof ClassType || t instanceof EnumType || t instanceof UnionType;
}

export type SeparatedNamedTypes = {
    classes: OrderedSet<ClassType>;
    enums: OrderedSet<EnumType>;
    unions: OrderedSet<UnionType>;
};

export function separateNamedTypes(types: Collection<any, Type>): SeparatedNamedTypes {
    const classes = types.filter((t: Type) => t instanceof ClassType).toOrderedSet() as OrderedSet<ClassType>;
    const enums = types.filter((t: Type) => t instanceof EnumType).toOrderedSet() as OrderedSet<EnumType>;
    const unions = types.filter((t: Type) => t instanceof UnionType).toOrderedSet() as OrderedSet<UnionType>;

    return { classes, enums, unions };
}

export function directlyReachableSingleNamedType(type: Type): Type | undefined {
    const definedTypes = type.directlyReachableTypes(t => {
        if (
            (!(t instanceof UnionType) && isNamedType(t)) ||
            (t instanceof UnionType && nullableFromUnion(t) === null)
        ) {
            return OrderedSet([t]);
        }
        return null;
    });
    assert(definedTypes.size <= 1, "Cannot have more than one defined type per top-level");
    return definedTypes.first();
}

export type StringTypeMatchers<U> = {
    dateType?: (dateType: PrimitiveType) => U;
    timeType?: (timeType: PrimitiveType) => U;
    dateTimeType?: (dateTimeType: PrimitiveType) => U;
};

export function matchTypeExhaustive<U>(
    t: Type,
    noneType: (noneType: PrimitiveType) => U,
    anyType: (anyType: PrimitiveType) => U,
    nullType: (nullType: PrimitiveType) => U,
    boolType: (boolType: PrimitiveType) => U,
    integerType: (integerType: PrimitiveType) => U,
    doubleType: (doubleType: PrimitiveType) => U,
    stringType: (stringType: StringType) => U,
    arrayType: (arrayType: ArrayType) => U,
    classType: (classType: ClassType) => U,
    mapType: (mapType: MapType) => U,
    enumType: (enumType: EnumType) => U,
    unionType: (unionType: UnionType) => U,
    dateType: (dateType: PrimitiveType) => U,
    timeType: (timeType: PrimitiveType) => U,
    dateTimeType: (dateTimeType: PrimitiveType) => U
): U {
    if (t.isPrimitive()) {
        const f = {
            none: noneType,
            any: anyType,
            null: nullType,
            bool: boolType,
            integer: integerType,
            double: doubleType,
            string: stringType as (t: PrimitiveType) => U,
            date: dateType,
            time: timeType,
            "date-time": dateTimeType
        }[t.kind];
        if (f !== undefined) return f(t);
        return assertNever(f);
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
    stringType: (stringType: StringType) => U,
    arrayType: (arrayType: ArrayType) => U,
    classType: (classType: ClassType) => U,
    mapType: (mapType: MapType) => U,
    enumType: (enumType: EnumType) => U,
    unionType: (unionType: UnionType) => U,
    stringTypeMatchers?: StringTypeMatchers<U>
): U {
    function typeNotSupported(_: Type) {
        return panic("Unsupported PrimitiveType");
    }

    if (stringTypeMatchers === undefined) {
        stringTypeMatchers = {};
    }
    /* tslint:disable:strict-boolean-expressions */
    return matchTypeExhaustive(
        t,
        typeNotSupported,
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
    /* tslint:enable */
}

export function matchCompoundType(
    t: Type,
    arrayType: (arrayType: ArrayType) => void,
    classType: (classType: ClassType) => void,
    mapType: (mapType: MapType) => void,
    unionType: (unionType: UnionType) => void
): void {
    function ignore<T extends Type>(_: T): void {
        return;
    }

    return matchType(
        t,
        ignore,
        ignore,
        ignore,
        ignore,
        ignore,
        ignore,
        arrayType,
        classType,
        mapType,
        ignore,
        unionType,
        { dateType: ignore, timeType: ignore, dateTimeType: ignore }
    );
}
