"use strict";

import { OrderedSet, OrderedMap, Set, is, hash, List } from "immutable";

import { defined, panic, assert, mapOptional } from "./Support";
import { TypeRef } from "./TypeBuilder";
import { TypeReconstituter, BaseGraphRewriteBuilder } from "./GraphRewriting";
import { TypeNames, namesTypeAttributeKind } from "./TypeNames";
import { TypeAttributes, TypeAttributeKind } from "./TypeAttributes";
import { ErrorMessage, messageAssert } from "./Messages";

export type PrimitiveStringTypeKind = "string" | "date" | "time" | "date-time";
export type PrimitiveTypeKind = "none" | "any" | "null" | "bool" | "integer" | "double" | PrimitiveStringTypeKind;
export type NamedTypeKind = "class" | "enum" | "union";
export type TypeKind = PrimitiveTypeKind | NamedTypeKind | "array" | "object" | "map" | "intersection";
export type ObjectTypeKind = "object" | "map" | "class";

export function isPrimitiveStringTypeKind(kind: TypeKind): kind is PrimitiveStringTypeKind {
    return kind === "string" || kind === "date" || kind === "time" || kind === "date-time";
}

export function isNumberTypeKind(kind: TypeKind): kind is "integer" | "double" {
    return kind === "integer" || kind === "double";
}

export function isPrimitiveTypeKind(kind: TypeKind): kind is PrimitiveTypeKind {
    if (isPrimitiveStringTypeKind(kind)) return true;
    if (isNumberTypeKind(kind)) return true;
    return kind === "none" || kind === "any" || kind === "null" || kind === "bool";
}

function triviallyStructurallyCompatible(x: Type, y: Type): boolean {
    if (x.typeRef.index === y.typeRef.index) return true;
    if (x.kind === "none" || y.kind === "none") return true;
    return false;
}

// FIXME: The outer OrderedSet should be some Collection, but I can't figure out
// which one.  Collection.Indexed doesn't work with OrderedSet, which is unfortunate.
function orderedSetUnion<T>(sets: OrderedSet<OrderedSet<T>>): OrderedSet<T> {
    const setArray = sets.toArray();
    if (setArray.length === 0) return OrderedSet();
    if (setArray.length === 1) return setArray[0];
    return setArray[0].union(...setArray.slice(1));
}

export const stringEnumCasesTypeAttributeKind = new TypeAttributeKind<OrderedMap<string, number> | null>(
    "stringEnumCases",
    true,
    (a, b) => {
        if (a === null || b === null) {
            return null;
        }
        return a.mergeWith((x, y) => x + y, b);
    },
    _ => undefined,
    m => {
        if (m === null) {
            return "no enum";
        }
        const firstKey = m.keySeq().first();
        if (firstKey === undefined) {
            return "enum with no cases";
        }
        return `${m.size.toString()} enums: ${firstKey} (${m.get(firstKey)}), ...`;
    }
);

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

    abstract get isNullable(): boolean;
    // FIXME: Remove `isPrimitive`
    abstract isPrimitive(): this is PrimitiveType;
    abstract get identity(): List<any> | undefined;
    abstract reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>): void;

    get debugPrintKind(): string {
        return this.kind;
    }

    equals(other: any): boolean {
        if (!(other instanceof Type)) return false;
        return this.typeRef.equals(other.typeRef);
    }

    hashCode(): number {
        return this.typeRef.hashCode();
    }

    // This will only ever be called when `this` and `other` are not
    // equal, but `this.kind === other.kind`.
    protected abstract structuralEqualityStep(
        other: Type,
        conflateNumbers: boolean,
        queue: (a: Type, b: Type) => boolean
    ): boolean;

    structurallyCompatible(other: Type, conflateNumbers: boolean = false): boolean {
        function kindsCompatible(kind1: TypeKind, kind2: TypeKind): boolean {
            if (kind1 === kind2) return true;
            if (!conflateNumbers) return false;
            if (kind1 === "integer") return kind2 === "double";
            if (kind1 === "double") return kind2 === "integer";
            return false;
        }

        if (triviallyStructurallyCompatible(this, other)) return true;
        if (!kindsCompatible(this.kind, other.kind)) return false;

        const workList: [Type, Type][] = [[this, other]];
        // This contains a set of pairs which are the type pairs
        // we have already determined to be equal.  We can't just
        // do comparison recursively because types can have cycles.
        const done: [number, number][] = [];

        let failed: boolean;
        const queue = (x: Type, y: Type): boolean => {
            if (triviallyStructurallyCompatible(x, y)) return true;
            if (!kindsCompatible(x.kind, y.kind)) {
                failed = true;
                return false;
            }
            workList.push([x, y]);
            return true;
        };

        while (workList.length > 0) {
            let [a, b] = defined(workList.pop());
            if (a.typeRef.index > b.typeRef.index) {
                [a, b] = [b, a];
            }

            if (!a.isPrimitive()) {
                let ai = a.typeRef.index;
                let bi = b.typeRef.index;

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
            if (!a.structuralEqualityStep(b, conflateNumbers, queue)) return false;
            if (failed) return false;
        }

        return true;
    }

    getParentTypes(): Set<Type> {
        return this.typeRef.graph.getParentsOfType(this);
    }

    getAncestorsNotInSet(set: Set<TypeRef>): Set<Type> {
        const workList: Type[] = [this];
        let processed: Set<Type> = Set();
        let ancestors: Set<Type> = Set();
        for (;;) {
            const t = workList.pop();
            if (t === undefined) break;

            const parents = t.getParentTypes();
            console.log(`${parents.size} parents`);
            parents.forEach(p => {
                if (processed.has(p)) return;
                processed = processed.add(p);
                if (set.has(p.typeRef)) {
                    console.log(`adding ${p.kind}`);
                    workList.push(p);
                } else {
                    console.log(`found ${p.kind}`);
                    ancestors = ancestors.add(p);
                }
            });
        }
        return ancestors;
    }
}

function identityAttributes(attributes: TypeAttributes): TypeAttributes {
    return attributes.filter((_, kind) => kind.inIdentity);
}

export function primitiveTypeIdentity(kind: PrimitiveTypeKind, attributes: TypeAttributes): List<any> {
    return List([kind, identityAttributes(attributes)]);
}

export class PrimitiveType extends Type {
    // @ts-ignore: This is initialized in the Type constructor
    readonly kind: PrimitiveTypeKind;

    get children(): OrderedSet<Type> {
        return OrderedSet();
    }

    get isNullable(): boolean {
        return this.kind === "null" || this.kind === "any" || this.kind === "none";
    }

    isPrimitive(): this is PrimitiveType {
        return true;
    }

    get identity(): List<any> | undefined {
        return primitiveTypeIdentity(this.kind, this.getAttributes());
    }

    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>): void {
        builder.getPrimitiveType(this.kind);
    }

    protected structuralEqualityStep(
        _other: Type,
        _conflateNumbers: boolean,
        _queue: (a: Type, b: Type) => boolean
    ): boolean {
        return true;
    }
}

export function arrayTypeIdentity(attributes: TypeAttributes, itemsRef: TypeRef): List<any> {
    return List(["array", identityAttributes(attributes), itemsRef]);
}

export class ArrayType extends Type {
    // @ts-ignore: This is initialized in the Type constructor
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

    get identity(): List<any> {
        return arrayTypeIdentity(this.getAttributes(), this.getItemsRef());
    }

    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>): void {
        const itemsRef = this.getItemsRef();
        const maybeItems = builder.lookup(itemsRef);
        if (maybeItems === undefined) {
            builder.getUniqueArrayType();
            builder.setArrayItems(builder.reconstitute(this.getItemsRef()));
        } else {
            builder.getArrayType(maybeItems);
        }
    }

    protected structuralEqualityStep(
        other: ArrayType,
        _conflateNumbers: boolean,
        queue: (a: Type, b: Type) => boolean
    ): boolean {
        return queue(this.items, other.items);
    }
}

export class GenericClassProperty<T> {
    constructor(readonly typeData: T, readonly isOptional: boolean) {}

    equals(other: any): boolean {
        if (!(other instanceof GenericClassProperty)) {
            return false;
        }
        return is(this.typeData, other.typeData) && this.isOptional === other.isOptional;
    }

    hashCode(): number {
        return hash(this.typeData) + (this.isOptional ? 17 : 23);
    }
}

export class ClassProperty extends GenericClassProperty<TypeRef> {
    constructor(typeRef: TypeRef, isOptional: boolean) {
        super(typeRef, isOptional);
    }

    get typeRef(): TypeRef {
        return this.typeData;
    }

    get type(): Type {
        return this.typeRef.deref()[0];
    }
}

function objectTypeIdentify(
    kind: ObjectTypeKind,
    attributes: TypeAttributes,
    properties: OrderedMap<string, ClassProperty>,
    additionalPropertiesRef: TypeRef | undefined
): List<any> {
    return List([kind, identityAttributes(attributes), properties.toMap(), additionalPropertiesRef]);
}

export function classTypeIdentity(
    attributes: TypeAttributes,
    properties: OrderedMap<string, ClassProperty>
): List<any> {
    return objectTypeIdentify("class", attributes, properties, undefined);
}

export function mapTypeIdentify(attributes: TypeAttributes, additionalPropertiesRef: TypeRef | undefined): List<any> {
    return objectTypeIdentify("map", attributes, OrderedMap(), additionalPropertiesRef);
}

export class ObjectType extends Type {
    // @ts-ignore: This is initialized in the Type constructor
    readonly kind: ObjectTypeKind;

    constructor(
        typeRef: TypeRef,
        kind: ObjectTypeKind,
        readonly isFixed: boolean,
        private _properties: OrderedMap<string, ClassProperty> | undefined,
        private _additionalPropertiesRef: TypeRef | undefined
    ) {
        super(typeRef, kind);

        if (kind === "map") {
            if (_properties !== undefined) {
                assert(_properties.isEmpty());
            }
            assert(!isFixed);
        } else if (kind === "class") {
            assert(_additionalPropertiesRef === undefined);
        } else {
            assert(isFixed);
        }
    }

    setProperties(properties: OrderedMap<string, ClassProperty>, additionalPropertiesRef: TypeRef | undefined) {
        assert(this._properties === undefined, "Tried to set object properties twice");

        if (this instanceof MapType) {
            assert(properties.isEmpty(), "Cannot set properties on map type");
        }

        if (this instanceof ClassType) {
            assert(additionalPropertiesRef === undefined, "Cannot set additional properties of class type");
        }

        this._properties = properties;
        this._additionalPropertiesRef = additionalPropertiesRef;
    }

    getProperties(): OrderedMap<string, ClassProperty> {
        return defined(this._properties);
    }

    getSortedProperties(): OrderedMap<string, ClassProperty> {
        const properties = this.getProperties();
        const sortedKeys = properties.keySeq().sort();
        const props = sortedKeys.map((k: string): [string, ClassProperty] => [k, defined(properties.get(k))]);
        return OrderedMap(props);
    }

    private getAdditionalPropertiesRef(): TypeRef | undefined {
        assert(this._properties !== undefined, "Properties are not set yet");
        return this._additionalPropertiesRef;
    }

    getAdditionalProperties(): Type | undefined {
        const tref = this.getAdditionalPropertiesRef();
        if (tref === undefined) return undefined;
        return tref.deref()[0];
    }

    get children(): OrderedSet<Type> {
        const children = this.getSortedProperties()
            .map(p => p.type)
            .toOrderedSet();
        const additionalProperties = this.getAdditionalProperties();
        if (additionalProperties === undefined) {
            return children;
        }
        return children.add(additionalProperties);
    }

    get isNullable(): boolean {
        return false;
    }

    isPrimitive(): this is PrimitiveType {
        return false;
    }

    get identity(): List<any> | undefined {
        if (this.isFixed) return undefined;
        return objectTypeIdentify(
            this.kind,
            this.getAttributes(),
            this.getProperties(),
            this.getAdditionalPropertiesRef()
        );
    }

    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>): void {
        const maybePropertyTypes = builder.lookup(this.getProperties().map(cp => cp.typeRef));
        const maybeAdditionalProperties = mapOptional(r => builder.lookup(r), this._additionalPropertiesRef);

        if (
            maybePropertyTypes !== undefined &&
            (maybeAdditionalProperties !== undefined || this._additionalPropertiesRef === undefined)
        ) {
            const properties = this.getProperties().map(
                (cp, n) => new ClassProperty(defined(maybePropertyTypes.get(n)), cp.isOptional)
            );

            switch (this.kind) {
                case "object":
                    assert(this.isFixed);
                    builder.getObjectType(properties, maybeAdditionalProperties);
                    break;
                case "map":
                    builder.getMapType(defined(maybeAdditionalProperties));
                    break;
                case "class":
                    if (this.isFixed) {
                        builder.getUniqueClassType(true, properties);
                    } else {
                        builder.getClassType(properties);
                    }
                    break;
                default:
                    return panic(`Invalid object type kind ${this.kind}`);
            }
        } else {
            switch (this.kind) {
                case "object":
                    assert(this.isFixed);
                    builder.getUniqueObjectType(undefined, undefined);
                    break;
                case "map":
                    builder.getUniqueMapType();
                    break;
                case "class":
                    builder.getUniqueClassType(this.isFixed, undefined);
                    break;
                default:
                    return panic(`Invalid object type kind ${this.kind}`);
            }

            const properties = this.getProperties().map(
                cp => new ClassProperty(builder.reconstitute(cp.typeRef), cp.isOptional)
            );
            const additionalProperties = mapOptional(r => builder.reconstitute(r), this._additionalPropertiesRef);
            builder.setObjectProperties(properties, additionalProperties);
        }
    }

    protected structuralEqualityStep(
        other: ObjectType,
        _conflateNumbers: boolean,
        queue: (a: Type, b: Type) => boolean
    ): boolean {
        const pa = this.getProperties();
        const pb = other.getProperties();
        if (pa.size !== pb.size) return false;
        let failed = false;
        pa.forEach((cpa, name) => {
            const cpb = pb.get(name);
            if (cpb === undefined || cpa.isOptional !== cpb.isOptional || !queue(cpa.type, cpb.type)) {
                failed = true;
                return false;
            }
        });
        if (failed) return false;

        const thisAdditionalProperties = this.getAdditionalProperties();
        const otherAdditionalProperties = other.getAdditionalProperties();
        if ((thisAdditionalProperties === undefined) !== (otherAdditionalProperties === undefined)) return false;
        if (thisAdditionalProperties === undefined || otherAdditionalProperties === undefined) return true;
        return queue(thisAdditionalProperties, otherAdditionalProperties);
    }
}

export class ClassType extends ObjectType {
    // @ts-ignore: This is initialized in the Type constructor
    kind: "class";

    constructor(typeRef: TypeRef, isFixed: boolean, properties: OrderedMap<string, ClassProperty> | undefined) {
        super(typeRef, "class", isFixed, properties, undefined);
    }
}

export class MapType extends ObjectType {
    // @ts-ignore: This is initialized in the Type constructor
    readonly kind: "map";

    constructor(typeRef: TypeRef, valuesRef: TypeRef | undefined) {
        super(typeRef, "map", false, mapOptional(() => OrderedMap(), valuesRef), valuesRef);
    }

    // FIXME: Remove and use `getAdditionalProperties()` instead.
    get values(): Type {
        return defined(this.getAdditionalProperties());
    }
}

export function enumTypeIdentity(attributes: TypeAttributes, cases: OrderedSet<string>): List<any> {
    return List(["enum", identityAttributes(attributes), cases.toSet()]);
}

export class EnumType extends Type {
    // @ts-ignore: This is initialized in the Type constructor
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

    get identity(): List<any> {
        return enumTypeIdentity(this.getAttributes(), this.cases);
    }

    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>): void {
        builder.getEnumType(this.cases);
    }

    protected structuralEqualityStep(
        other: EnumType,
        _conflateNumbers: boolean,
        _queue: (a: Type, b: Type) => void
    ): boolean {
        return this.cases.toSet().equals(other.cases.toSet());
    }
}

export function setOperationCasesEqual(
    ma: OrderedSet<Type>,
    mb: OrderedSet<Type>,
    conflateNumbers: boolean,
    membersEqual: (a: Type, b: Type) => boolean
): boolean {
    if (ma.size !== mb.size) return false;
    return ma.every(ta => {
        const tb = mb.find(t => t.kind === ta.kind);
        if (tb !== undefined) {
            if (membersEqual(ta, tb)) return true;
        }
        if (conflateNumbers) {
            if (ta.kind === "integer" && mb.some(t => t.kind === "double")) return true;
            if (ta.kind === "double" && mb.some(t => t.kind === "integer")) return true;
        }
        return false;
    });
}

export function setOperationTypeIdentity(
    kind: TypeKind,
    attributes: TypeAttributes,
    memberRefs: OrderedSet<TypeRef>
): List<any> {
    return List([kind, identityAttributes(attributes), memberRefs.toSet()]);
}

export function unionTypeIdentity(attributes: TypeAttributes, memberRefs: OrderedSet<TypeRef>): List<any> {
    return setOperationTypeIdentity("union", attributes, memberRefs);
}

export function intersectionTypeIdentity(attributes: TypeAttributes, memberRefs: OrderedSet<TypeRef>): List<any> {
    return setOperationTypeIdentity("intersection", attributes, memberRefs);
}

export abstract class SetOperationType extends Type {
    constructor(typeRef: TypeRef, kind: TypeKind, private _memberRefs?: OrderedSet<TypeRef>) {
        super(typeRef, kind);
    }

    setMembers(memberRefs: OrderedSet<TypeRef>): void {
        if (this._memberRefs !== undefined) {
            return panic("Can only set map members once");
        }
        this._memberRefs = memberRefs;
    }

    protected getMemberRefs(): OrderedSet<TypeRef> {
        if (this._memberRefs === undefined) {
            return panic("Map members accessed before they were set");
        }
        return this._memberRefs;
    }

    get members(): OrderedSet<Type> {
        return this.getMemberRefs().map(tref => tref.deref()[0]);
    }

    get sortedMembers(): OrderedSet<Type> {
        // FIXME: We're assuming no two members of the same kind.
        return this.members.sortBy(t => t.kind);
    }

    get children(): OrderedSet<Type> {
        return this.sortedMembers;
    }

    isPrimitive(): this is PrimitiveType {
        return false;
    }

    get identity(): List<any> {
        return setOperationTypeIdentity(this.kind, this.getAttributes(), this.getMemberRefs());
    }

    protected structuralEqualityStep(
        other: SetOperationType,
        conflateNumbers: boolean,
        queue: (a: Type, b: Type) => boolean
    ): boolean {
        return setOperationCasesEqual(this.members, other.members, conflateNumbers, queue);
    }
}

export class IntersectionType extends SetOperationType {
    // @ts-ignore: This is initialized in the Type constructor
    kind: "intersection";

    constructor(typeRef: TypeRef, memberRefs?: OrderedSet<TypeRef>) {
        super(typeRef, "intersection", memberRefs);
    }

    get isNullable(): boolean {
        return panic("isNullable not implemented for IntersectionType");
    }

    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>): void {
        const memberRefs = this.getMemberRefs();
        const maybeMembers = builder.lookup(memberRefs);
        if (maybeMembers === undefined) {
            builder.getUniqueIntersectionType();
            builder.setSetOperationMembers(builder.reconstitute(memberRefs));
        } else {
            builder.getIntersectionType(maybeMembers);
        }
    }
}

export class UnionType extends SetOperationType {
    // @ts-ignore: This is initialized in the Type constructor
    kind: "union";

    constructor(typeRef: TypeRef, memberRefs?: OrderedSet<TypeRef>) {
        super(typeRef, "union", memberRefs);
        if (memberRefs !== undefined) {
            messageAssert(!memberRefs.isEmpty(), ErrorMessage.IRNoEmptyUnions);
        }
    }

    setMembers(memberRefs: OrderedSet<TypeRef>): void {
        messageAssert(!memberRefs.isEmpty(), ErrorMessage.IRNoEmptyUnions);
        super.setMembers(memberRefs);
    }

    get stringTypeMembers(): OrderedSet<Type> {
        return this.members.filter(t => ["string", "date", "time", "date-time", "enum"].indexOf(t.kind) >= 0);
    }

    findMember(kind: TypeKind): Type | undefined {
        return this.members.find((t: Type) => t.kind === kind);
    }

    get isNullable(): boolean {
        return this.findMember("null") !== undefined;
    }

    get isCanonical(): boolean {
        const members = this.members;
        if (members.size <= 1) return false;
        const kinds = members.map(t => t.kind);
        if (kinds.size < members.size) return false;
        if (kinds.has("union") || kinds.has("intersection")) return false;
        if (kinds.has("none") || kinds.has("any")) return false;
        if (kinds.has("string") && kinds.has("enum")) return false;

        let numObjectTypes = 0;
        if (kinds.has("class")) numObjectTypes += 1;
        if (kinds.has("map")) numObjectTypes += 1;
        if (kinds.has("object")) numObjectTypes += 1;
        if (numObjectTypes > 1) return false;

        return true;
    }

    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>): void {
        const memberRefs = this.getMemberRefs();
        const maybeMembers = builder.lookup(memberRefs);
        if (maybeMembers === undefined) {
            builder.getUniqueUnionType();
            builder.setSetOperationMembers(builder.reconstitute(memberRefs));
        } else {
            builder.getUnionType(maybeMembers);
        }
    }
}
