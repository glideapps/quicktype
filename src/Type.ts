"use strict";

import { OrderedSet, OrderedMap, Collection, Map, Set, is, hash } from "immutable";

import { defined, panic, assert, assertNever, mapOptional } from "./Support";
import { TypeRef, TypeReconstituter, BaseGraphRewriteBuilder } from "./TypeBuilder";
import { TypeNames, namesTypeAttributeKind } from "./TypeNames";
import { TypeAttributes, combineTypeAttributes, emptyTypeAttributes } from "./TypeAttributes";
import { ErrorMessage, messageAssert } from "./Messages";
import { TypeGraph } from "./TypeGraph";

export type PrimitiveStringTypeKind = "string" | "date" | "time" | "date-time";
export type PrimitiveTypeKind = "none" | "any" | "null" | "bool" | "integer" | "double" | PrimitiveStringTypeKind;
export type NamedTypeKind = "class" | "enum" | "union";
export type TypeKind = PrimitiveTypeKind | NamedTypeKind | "array" | "object" | "map" | "intersection";

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
    if (x.index === y.index) return true;
    if (x.kind === "none" || y.kind === "none") return true;
    return false;
}

export abstract class Type {
    protected readonly graph: TypeGraph;
    readonly index: number;

    constructor(typeRef: TypeRef, readonly kind: TypeKind) {
        this.graph = typeRef.graph;
        this.index = typeRef.index;
    }

    abstract get children(): OrderedSet<Type>;

    directlyReachableTypes<T>(setForType: (t: Type) => OrderedSet<T> | null): OrderedSet<T> {
        const set = setForType(this);
        if (set) return set;
        return orderedSetUnion(this.children.map((t: Type) => t.directlyReachableTypes(setForType)));
    }

    getAttributes(): TypeAttributes {
        return this.graph.atIndex(this.index)[1];
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
    abstract isPrimitive(): this is PrimitiveType;
    abstract reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>): void;

    equals(other: any): boolean {
        if (!(other instanceof Type)) return false;

        assert(this.graph === other.graph, "Comparing types of different graphs");
        return this.index === other.index;
    }

    hashCode(): number {
        return this.index | 0;
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
            if (a.index > b.index) {
                [a, b] = [b, a];
            }

            if (!a.isPrimitive()) {
                let ai = a.index;
                let bi = b.index;

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

    getParentTypes(): Set<Type> {
        return this.graph.getParentsOfType(this);
    }

    getAncestorsNotInSet(set: Set<Type>): Set<Type> {
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
                if (set.has(p)) {
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

export class PrimitiveType extends Type {
    // @ts-ignore: This is initialized in the Type constructor
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

    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>): void {
        builder.getPrimitiveType(this.kind);
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

    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>): void {
        builder.getStringType(this.enumCases);
    }

    protected structuralEqualityStep(_other: Type, _queue: (a: Type, b: Type) => boolean): boolean {
        return true;
    }
}

export class ArrayType extends Type {
    // @ts-ignore: This is initialized in the Type constructor
    readonly kind: "array";

    private _itemsIndex: number | undefined;

    constructor(typeRef: TypeRef, itemsRef?: TypeRef) {
        super(typeRef, "array");

        if (itemsRef !== undefined) {
            this._itemsIndex = itemsRef.index;
        }
    }

    setItems(itemsRef: TypeRef) {
        if (this._itemsIndex !== undefined) {
            return panic("Can only set array items once");
        }
        this._itemsIndex = itemsRef.index;
    }

    private getItemsIndex(): number {
        if (this._itemsIndex === undefined) {
            return panic("Array items accessed before they were set");
        }
        return this._itemsIndex;
    }

    get items(): Type {
        return this.graph.atIndex(this.getItemsIndex())[0];
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

    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>): void {
        const maybeItems = builder.lookup(this);
        if (maybeItems === undefined) {
            builder.getUniqueArrayType();
            builder.setArrayItems(builder.reconstitute(this);
        } else {
            builder.getArrayType(maybeItems);
        }
    }

    protected structuralEqualityStep(other: ArrayType, queue: (a: Type, b: Type) => boolean): boolean {
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

export class ObjectType extends Type {
    constructor(
        typeRef: TypeRef,
        kind: TypeKind,
        readonly isFixed: boolean,
        private _properties: OrderedMap<string, ClassProperty> | undefined,
        private _additionalPropertiesRef: TypeRef | undefined
    ) {
        super(typeRef, kind);

        assert(kind === "object" || kind === "map" || kind === "class");
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
        if (this instanceof MapType) {
            assert(properties.isEmpty(), "Cannot set properties on map type");
        } else if (this._properties !== undefined) {
            return panic("Tried to set object properties again");
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

    getAdditionalProperties(): Type | undefined {
        assert(this._properties !== undefined, "Properties are not set yet");
        if (this._additionalPropertiesRef === undefined) return undefined;
        return this._additionalPropertiesRef.deref()[0];
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

    protected structuralEqualityStep(other: ObjectType, queue: (a: Type, b: Type) => boolean): boolean {
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
        super(typeRef, "map", false, OrderedMap(), valuesRef);
    }

    // FIXME: Remove and use `getAdditionalProperties()` instead.
    get values(): Type {
        return defined(this.getAdditionalProperties());
    }
}

export function assertIsObject(t: Type): ObjectType {
    if (t instanceof ObjectType) {
        return t;
    }
    return panic("Supposed object type is not an object type");
}

export function assertIsClass(t: Type): ClassType {
    if (!(t instanceof ClassType)) {
        return panic("Supposed class type is not a class type");
    }
    return t;
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

    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>): void {
        builder.getEnumType(this.cases);
    }

    protected structuralEqualityStep(other: EnumType, _queue: (a: Type, b: Type) => void): boolean {
        return this.cases.toSet().equals(other.cases.toSet());
    }
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

    protected structuralEqualityStep(other: SetOperationType, queue: (a: Type, b: Type) => boolean): boolean {
        return setOperationCasesEqual(this.members, other.members, queue);
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

export function setOperationMembersRecursively<T extends SetOperationType>(
    setOperation: T
): [OrderedSet<Type>, TypeAttributes];
export function setOperationMembersRecursively<T extends SetOperationType>(
    setOperations: T[]
): [OrderedSet<Type>, TypeAttributes];
export function setOperationMembersRecursively<T extends SetOperationType>(
    oneOrMany: T | T[]
): [OrderedSet<Type>, TypeAttributes] {
    const setOperations = Array.isArray(oneOrMany) ? oneOrMany : [oneOrMany];
    const kind = setOperations[0].kind;
    const includeAny = kind !== "intersection";
    let processedSetOperations = Set<T>();
    let members = OrderedSet<Type>();
    let attributes = emptyTypeAttributes;

    function process(t: Type): void {
        if (t.kind === kind) {
            const so = t as T;
            if (processedSetOperations.has(so)) return;
            processedSetOperations = processedSetOperations.add(so);
            attributes = combineTypeAttributes(attributes, t.getAttributes());
            so.members.forEach(process);
        } else if (includeAny || t.kind !== "any") {
            members = members.add(t);
        } else {
            attributes = combineTypeAttributes(attributes, t.getAttributes());
        }
    }

    for (const so of setOperations) {
        process(so);
    }
    return [members, attributes];
}

export function makeGroupsToFlatten<T extends SetOperationType>(
    setOperations: Set<T>,
    include: ((members: Set<Type>) => boolean) | undefined
): Type[][] {
    let typeGroups = Map<Set<Type>, OrderedSet<Type>>();
    setOperations.forEach(u => {
        const members = setOperationMembersRecursively(u)[0].toSet();

        if (include !== undefined) {
            if (!include(members)) return;
        }

        let maybeSet = typeGroups.get(members);
        if (maybeSet === undefined) {
            maybeSet = OrderedSet();
            if (members.size === 1) {
                maybeSet = maybeSet.add(defined(members.first()));
            }
        }
        maybeSet = maybeSet.add(u);
        typeGroups = typeGroups.set(members, maybeSet);
    });

    return typeGroups
        .valueSeq()
        .toArray()
        .map(ts => ts.toArray());
}

export function combineTypeAttributesOfTypes(types: Type[]): TypeAttributes;
export function combineTypeAttributesOfTypes(types: Collection<any, Type>): TypeAttributes;
export function combineTypeAttributesOfTypes(types: Type[] | Collection<any, Type>): TypeAttributes {
    if (!Array.isArray(types)) {
        types = types.valueSeq().toArray();
    }
    return combineTypeAttributes(types.map(t => t.getAttributes()));
}

export function setOperationCasesEqual(
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

// FIXME: We shouldn't have to sort here.  This is just because we're not getting
// back the right order from JSON Schema, due to the changes the intersection types
// introduced.
export function removeNullFromUnion(
    t: UnionType,
    sortBy: boolean | ((t: Type) => any) = false
): [PrimitiveType | null, OrderedSet<Type>] {
    function sort(s: OrderedSet<Type>): OrderedSet<Type> {
        if (sortBy === false) return s;
        if (sortBy === true) return s.sortBy(m => m.kind);
        return s.sortBy(sortBy);
    }

    const nullType = t.findMember("null");
    if (nullType === undefined) {
        return [null, sort(t.members)];
    }
    return [nullType as PrimitiveType, sort(t.members.filterNot(isNull))];
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
    return ["class", "union", "enum", "object"].indexOf(t.kind) >= 0;
}

export type SeparatedNamedTypes = {
    objects: OrderedSet<ObjectType>;
    enums: OrderedSet<EnumType>;
    unions: OrderedSet<UnionType>;
};

export function separateNamedTypes(types: Collection<any, Type>): SeparatedNamedTypes {
    const objects = types.filter((t: Type) => t.kind === "object" || t.kind === "class").toOrderedSet() as OrderedSet<
        ObjectType
    >;
    const enums = types.filter((t: Type) => t instanceof EnumType).toOrderedSet() as OrderedSet<EnumType>;
    const unions = types.filter((t: Type) => t instanceof UnionType).toOrderedSet() as OrderedSet<UnionType>;

    return { objects, enums, unions };
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
    objectType: (objectType: ObjectType) => U,
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
    else if (t instanceof ObjectType) return objectType(t);
    else if (t instanceof EnumType) return enumType(t);
    else if (t instanceof UnionType) return unionType(t);
    return panic(`Unknown type ${t.kind}`);
}

export function matchType<U>(
    type: Type,
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
    function typeNotSupported(t: Type) {
        return panic(`Unsupported type ${t.kind} in non-exhaustive match`);
    }

    if (stringTypeMatchers === undefined) {
        stringTypeMatchers = {};
    }
    /* tslint:disable:strict-boolean-expressions */
    return matchTypeExhaustive(
        type,
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
        typeNotSupported,
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
    objectType: (objectType: ObjectType) => void,
    unionType: (unionType: UnionType) => void
): void {
    function ignore<T extends Type>(_: T): void {
        return;
    }

    return matchTypeExhaustive(
        t,
        ignore,
        ignore,
        ignore,
        ignore,
        ignore,
        ignore,
        ignore,
        arrayType,
        classType,
        mapType,
        objectType,
        ignore,
        unionType,
        ignore,
        ignore,
        ignore
    );
}
