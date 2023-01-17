import {
    iterableEvery,
    iterableFind,
    iterableSome,
    toReadonlySet,
    hashCodeOf,
    areEqual,
    mapMap,
    setMap,
    mapSortByKey,
    mapSome,
    mapFilter,
    setSortBy,
    setFilter,
    setUnionInto,
    mapSortToArray,
    definedMap,
    hashCodeInit,
    addHashCode,
    hasOwnProperty,
    mapFromObject
} from "collection-utils";

import { defined, panic, assert } from "./support/Support";
import { TypeReconstituter, BaseGraphRewriteBuilder } from "./GraphRewriting";
import { TypeNames, namesTypeAttributeKind } from "./attributes/TypeNames";
import { TypeAttributes } from "./attributes/TypeAttributes";
import { messageAssert } from "./Messages";
import { TypeRef, attributesForTypeRef, derefTypeRef, TypeGraph, typeRefIndex } from "./TypeGraph";
import { uriInferenceAttributesProducer } from "./attributes/URIAttributes";

/**
 * `jsonSchema` is the `format` to be used to represent this string type in
 * JSON Schema.  It's ok to "invent" a new one if the JSON Schema standard doesn't
 * have that particular type yet.
 *
 * For transformed type kinds that map to an existing primitive type, `primitive`
 * must specify that type kind.
 */
export type TransformedStringTypeTargets = {
    jsonSchema: string;
    primitive: PrimitiveNonStringTypeKind | undefined;
    attributesProducer?: (s: string) => TypeAttributes;
};

/**
 * All the transformed string type kinds and the JSON Schema formats and
 * primitive type kinds they map to.  Not all transformed string types map to
 * primitive types.  Date-time types, for example, stand on their own, but
 * stringified integers map to integers.
 */
const transformedStringTypeTargetTypeKinds = {
    date: { jsonSchema: "date", primitive: undefined },
    time: { jsonSchema: "time", primitive: undefined },
    "date-time": { jsonSchema: "date-time", primitive: undefined },
    uuid: { jsonSchema: "uuid", primitive: undefined },
    uri: { jsonSchema: "uri", primitive: undefined, attributesProducer: uriInferenceAttributesProducer },
    "integer-string": { jsonSchema: "integer", primitive: "integer" } as TransformedStringTypeTargets,
    "bool-string": { jsonSchema: "boolean", primitive: "bool" } as TransformedStringTypeTargets
};

export const transformedStringTypeTargetTypeKindsMap = mapFromObject(
    transformedStringTypeTargetTypeKinds as {
        [kind: string]: TransformedStringTypeTargets;
    }
);

export type TransformedStringTypeKind = keyof typeof transformedStringTypeTargetTypeKinds;
export type PrimitiveStringTypeKind = "string" | TransformedStringTypeKind;
export type PrimitiveNonStringTypeKind = "none" | "any" | "null" | "bool" | "integer" | "double";
export type PrimitiveTypeKind = PrimitiveNonStringTypeKind | PrimitiveStringTypeKind;
export type NamedTypeKind = "class" | "enum" | "union";
export type TypeKind = PrimitiveTypeKind | NamedTypeKind | "array" | "object" | "map" | "intersection";
export type ObjectTypeKind = "object" | "map" | "class";

export const transformedStringTypeKinds = new Set(
    Object.getOwnPropertyNames(transformedStringTypeTargetTypeKinds)
) as ReadonlySet<TransformedStringTypeKind>;

export function isPrimitiveStringTypeKind(kind: string): kind is PrimitiveStringTypeKind {
    return kind === "string" || hasOwnProperty(transformedStringTypeTargetTypeKinds, kind);
}

export function targetTypeKindForTransformedStringTypeKind(
    kind: PrimitiveStringTypeKind
): PrimitiveNonStringTypeKind | undefined {
    const target = transformedStringTypeTargetTypeKindsMap.get(kind);
    if (target === undefined) return undefined;
    return target.primitive;
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

export class TypeIdentity {
    private readonly _hashCode: number;

    constructor(private readonly _kind: TypeKind, private readonly _components: ReadonlyArray<any>) {
        let h = hashCodeInit;
        h = addHashCode(h, hashCodeOf(this._kind));
        for (const c of _components) {
            h = addHashCode(h, hashCodeOf(c));
        }
        this._hashCode = h;
    }

    equals(other: any): boolean {
        if (!(other instanceof TypeIdentity)) return false;
        if (this._kind !== other._kind) return false;
        const n = this._components.length;
        assert(n === other._components.length, "Components of a type kind's identity must have the same length");
        for (let i = 0; i < n; i++) {
            if (!areEqual(this._components[i], other._components[i])) return false;
        }
        return true;
    }

    hashCode(): number {
        return this._hashCode;
    }
}

// undefined in case the identity is unique
export type MaybeTypeIdentity = TypeIdentity | undefined;

export abstract class Type {
    abstract readonly kind: TypeKind;

    constructor(readonly typeRef: TypeRef, protected readonly graph: TypeGraph) {}

    get index(): number {
        return typeRefIndex(this.typeRef);
    }

    // This must return a newly allocated set
    abstract getNonAttributeChildren(): Set<Type>;

    getChildren(): ReadonlySet<Type> {
        let result = this.getNonAttributeChildren();
        for (const [k, v] of this.getAttributes()) {
            if (k.children === undefined) continue;
            setUnionInto(result, k.children(v));
        }
        return result;
    }

    getAttributes(): TypeAttributes {
        return attributesForTypeRef(this.typeRef, this.graph);
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
    abstract get identity(): MaybeTypeIdentity;
    abstract reconstitute<T extends BaseGraphRewriteBuilder>(
        builder: TypeReconstituter<T>,
        canonicalOrder: boolean
    ): void;

    get debugPrintKind(): string {
        return this.kind;
    }

    equals(other: any): boolean {
        if (!(other instanceof Type)) return false;
        return this.typeRef === other.typeRef;
    }

    hashCode(): number {
        return hashCodeOf(this.typeRef);
    }

    // This will only ever be called when `this` and `other` are not
    // equal, but `this.kind === other.kind`.
    protected abstract structuralEqualityStep(
        other: Type,
        conflateNumbers: boolean,
        queue: (a: Type, b: Type) => boolean
    ): boolean;

    structurallyCompatible(other: Type, conflateNumbers = false): boolean {
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
            if (!a.structuralEqualityStep(b, conflateNumbers, queue)) return false;
            if (failed) return false;
        }

        return true;
    }

    getParentTypes(): ReadonlySet<Type> {
        return this.graph.getParentsOfType(this);
    }

    getAncestorsNotInSet(set: ReadonlySet<TypeRef>): ReadonlySet<Type> {
        const workList: Type[] = [this];
        const processed = new Set<Type>();
        const ancestors = new Set<Type>();
        for (;;) {
            const t = workList.pop();
            if (t === undefined) break;

            const parents = t.getParentTypes();
            console.log(`${parents.size} parents`);
            for (const p of parents) {
                if (processed.has(p)) continue;
                processed.add(p);
                if (set.has(p.typeRef)) {
                    console.log(`adding ${p.kind}`);
                    workList.push(p);
                } else {
                    console.log(`found ${p.kind}`);
                    ancestors.add(p);
                }
            }
        }
        return ancestors;
    }
}

function hasUniqueIdentityAttributes(attributes: TypeAttributes): boolean {
    return mapSome(attributes, (v, ta) => ta.requiresUniqueIdentity(v));
}

function identityAttributes(attributes: TypeAttributes): TypeAttributes {
    return mapFilter(attributes, (_, kind) => kind.inIdentity);
}

export function primitiveTypeIdentity(kind: PrimitiveTypeKind, attributes: TypeAttributes): MaybeTypeIdentity {
    if (hasUniqueIdentityAttributes(attributes)) return undefined;
    return new TypeIdentity(kind, [identityAttributes(attributes)]);
}

export class PrimitiveType extends Type {
    constructor(typeRef: TypeRef, graph: TypeGraph, public readonly kind: PrimitiveTypeKind) {
        super(typeRef, graph);
    }

    get isNullable(): boolean {
        return this.kind === "null" || this.kind === "any" || this.kind === "none";
    }

    isPrimitive(): this is PrimitiveType {
        return true;
    }

    getNonAttributeChildren(): Set<Type> {
        return new Set();
    }

    get identity(): MaybeTypeIdentity {
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

export function arrayTypeIdentity(attributes: TypeAttributes, itemsRef: TypeRef): MaybeTypeIdentity {
    if (hasUniqueIdentityAttributes(attributes)) return undefined;
    return new TypeIdentity("array", [identityAttributes(attributes), itemsRef]);
}

export class ArrayType extends Type {
    public readonly kind = "array";

    constructor(typeRef: TypeRef, graph: TypeGraph, private _itemsRef?: TypeRef) {
        super(typeRef, graph);
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
        return derefTypeRef(this.getItemsRef(), this.graph);
    }

    getNonAttributeChildren(): Set<Type> {
        return new Set([this.items]);
    }

    get isNullable(): boolean {
        return false;
    }

    isPrimitive(): this is PrimitiveType {
        return false;
    }

    get identity(): MaybeTypeIdentity {
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
        return areEqual(this.typeData, other.typeData) && this.isOptional === other.isOptional;
    }

    hashCode(): number {
        return hashCodeOf(this.typeData) + (this.isOptional ? 17 : 23);
    }
}

export class ClassProperty extends GenericClassProperty<TypeRef> {
    constructor(typeRef: TypeRef, readonly graph: TypeGraph, isOptional: boolean) {
        super(typeRef, isOptional);
    }

    get typeRef(): TypeRef {
        return this.typeData;
    }

    get type(): Type {
        return derefTypeRef(this.typeRef, this.graph);
    }
}

function objectTypeIdentify(
    kind: ObjectTypeKind,
    attributes: TypeAttributes,
    properties: ReadonlyMap<string, ClassProperty>,
    additionalPropertiesRef: TypeRef | undefined
): MaybeTypeIdentity {
    if (hasUniqueIdentityAttributes(attributes)) return undefined;
    return new TypeIdentity(kind, [identityAttributes(attributes), properties, additionalPropertiesRef]);
}

export function classTypeIdentity(
    attributes: TypeAttributes,
    properties: ReadonlyMap<string, ClassProperty>
): MaybeTypeIdentity {
    return objectTypeIdentify("class", attributes, properties, undefined);
}

export function mapTypeIdentify(
    attributes: TypeAttributes,
    additionalPropertiesRef: TypeRef | undefined
): MaybeTypeIdentity {
    return objectTypeIdentify("map", attributes, new Map(), additionalPropertiesRef);
}

export class ObjectType extends Type {
    constructor(
        typeRef: TypeRef,
        graph: TypeGraph,
        public readonly kind: ObjectTypeKind,
        readonly isFixed: boolean,
        private _properties: ReadonlyMap<string, ClassProperty> | undefined,
        private _additionalPropertiesRef: TypeRef | undefined
    ) {
        super(typeRef, graph);

        if (kind === "map") {
            if (_properties !== undefined) {
                assert(_properties.size === 0);
            }
            assert(!isFixed);
        } else if (kind === "class") {
            assert(_additionalPropertiesRef === undefined);
        } else {
            assert(isFixed);
        }
    }

    setProperties(properties: ReadonlyMap<string, ClassProperty>, additionalPropertiesRef: TypeRef | undefined) {
        assert(this._properties === undefined, "Tried to set object properties twice");

        if (this instanceof MapType) {
            assert(properties.size === 0, "Cannot set properties on map type");
        }

        if (this instanceof ClassType) {
            assert(additionalPropertiesRef === undefined, "Cannot set additional properties of class type");
        }

        this._properties = properties;
        this._additionalPropertiesRef = additionalPropertiesRef;
    }

    getProperties(): ReadonlyMap<string, ClassProperty> {
        return defined(this._properties);
    }

    getSortedProperties(): ReadonlyMap<string, ClassProperty> {
        return mapSortByKey(this.getProperties());
    }

    private getAdditionalPropertiesRef(): TypeRef | undefined {
        assert(this._properties !== undefined, "Properties are not set yet");
        return this._additionalPropertiesRef;
    }

    getAdditionalProperties(): Type | undefined {
        const tref = this.getAdditionalPropertiesRef();
        if (tref === undefined) return undefined;
        return derefTypeRef(tref, this.graph);
    }

    getNonAttributeChildren(): Set<Type> {
        const types = mapSortToArray(this.getProperties(), (_, k) => k).map(([_, p]) => p.type);
        const additionalProperties = this.getAdditionalProperties();
        if (additionalProperties !== undefined) {
            types.push(additionalProperties);
        }
        return new Set(types);
    }

    get isNullable(): boolean {
        return false;
    }

    isPrimitive(): this is PrimitiveType {
        return false;
    }

    get identity(): MaybeTypeIdentity {
        if (this.isFixed) return undefined;
        return objectTypeIdentify(
            this.kind,
            this.getAttributes(),
            this.getProperties(),
            this.getAdditionalPropertiesRef()
        );
    }

    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>, canonicalOrder: boolean): void {
        const sortedProperties = this.getSortedProperties();
        const propertiesInNewOrder = canonicalOrder ? sortedProperties : this.getProperties();
        const maybePropertyTypes = builder.lookupMap(mapMap(sortedProperties, cp => cp.typeRef));
        const maybeAdditionalProperties = definedMap(this._additionalPropertiesRef, r => builder.lookup(r));

        if (
            maybePropertyTypes !== undefined &&
            (maybeAdditionalProperties !== undefined || this._additionalPropertiesRef === undefined)
        ) {
            const properties = mapMap(propertiesInNewOrder, (cp, n) =>
                builder.makeClassProperty(defined(maybePropertyTypes.get(n)), cp.isOptional)
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

            const reconstitutedTypes = mapMap(sortedProperties, cp => builder.reconstitute(cp.typeRef));
            const properties = mapMap(propertiesInNewOrder, (cp, n) =>
                builder.makeClassProperty(defined(reconstitutedTypes.get(n)), cp.isOptional)
            );
            const additionalProperties = definedMap(this._additionalPropertiesRef, r => builder.reconstitute(r));
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
        for (const [name, cpa] of pa) {
            const cpb = pb.get(name);
            if (cpb === undefined || cpa.isOptional !== cpb.isOptional || !queue(cpa.type, cpb.type)) {
                failed = true;
                return false;
            }
        }
        if (failed) return false;

        const thisAdditionalProperties = this.getAdditionalProperties();
        const otherAdditionalProperties = other.getAdditionalProperties();
        if ((thisAdditionalProperties === undefined) !== (otherAdditionalProperties === undefined)) return false;
        if (thisAdditionalProperties === undefined || otherAdditionalProperties === undefined) return true;
        return queue(thisAdditionalProperties, otherAdditionalProperties);
    }
}

export class ClassType extends ObjectType {
    constructor(
        typeRef: TypeRef,
        graph: TypeGraph,
        isFixed: boolean,
        properties: ReadonlyMap<string, ClassProperty> | undefined
    ) {
        super(typeRef, graph, "class", isFixed, properties, undefined);
    }
}

export class MapType extends ObjectType {
    constructor(typeRef: TypeRef, graph: TypeGraph, valuesRef: TypeRef | undefined) {
        super(
            typeRef,
            graph,
            "map",
            false,
            definedMap(valuesRef, () => new Map()),
            valuesRef
        );
    }

    // FIXME: Remove and use `getAdditionalProperties()` instead.
    get values(): Type {
        return defined(this.getAdditionalProperties());
    }
}

export function enumTypeIdentity(attributes: TypeAttributes, cases: ReadonlySet<string>): MaybeTypeIdentity {
    if (hasUniqueIdentityAttributes(attributes)) return undefined;
    return new TypeIdentity("enum", [identityAttributes(attributes), cases]);
}

export class EnumType extends Type {
    public readonly kind = "enum";

    constructor(typeRef: TypeRef, graph: TypeGraph, readonly cases: ReadonlySet<string>) {
        super(typeRef, graph);
    }

    get isNullable(): boolean {
        return false;
    }

    isPrimitive(): this is PrimitiveType {
        return false;
    }

    get identity(): MaybeTypeIdentity {
        return enumTypeIdentity(this.getAttributes(), this.cases);
    }

    getNonAttributeChildren(): Set<Type> {
        return new Set();
    }

    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>): void {
        builder.getEnumType(this.cases);
    }

    protected structuralEqualityStep(
        other: EnumType,
        _conflateNumbers: boolean,
        _queue: (a: Type, b: Type) => void
    ): boolean {
        return areEqual(this.cases, other.cases);
    }
}

export function setOperationCasesEqual(
    typesA: Iterable<Type>,
    typesB: Iterable<Type>,
    conflateNumbers: boolean,
    membersEqual: (a: Type, b: Type) => boolean
): boolean {
    const ma = toReadonlySet(typesA);
    const mb = toReadonlySet(typesB);
    if (ma.size !== mb.size) return false;
    return iterableEvery(ma, ta => {
        const tb = iterableFind(mb, t => t.kind === ta.kind);
        if (tb !== undefined) {
            if (membersEqual(ta, tb)) return true;
        }
        if (conflateNumbers) {
            if (ta.kind === "integer" && iterableSome(mb, t => t.kind === "double")) return true;
            if (ta.kind === "double" && iterableSome(mb, t => t.kind === "integer")) return true;
        }
        return false;
    });
}

export function setOperationTypeIdentity(
    kind: TypeKind,
    attributes: TypeAttributes,
    memberRefs: ReadonlySet<TypeRef>
): MaybeTypeIdentity {
    if (hasUniqueIdentityAttributes(attributes)) return undefined;
    return new TypeIdentity(kind, [identityAttributes(attributes), memberRefs]);
}

export function unionTypeIdentity(attributes: TypeAttributes, memberRefs: ReadonlySet<TypeRef>): MaybeTypeIdentity {
    return setOperationTypeIdentity("union", attributes, memberRefs);
}

export function intersectionTypeIdentity(
    attributes: TypeAttributes,
    memberRefs: ReadonlySet<TypeRef>
): MaybeTypeIdentity {
    return setOperationTypeIdentity("intersection", attributes, memberRefs);
}

export abstract class SetOperationType extends Type {
    constructor(
        typeRef: TypeRef,
        graph: TypeGraph,
        public readonly kind: TypeKind,
        private _memberRefs?: ReadonlySet<TypeRef>
    ) {
        super(typeRef, graph);
    }

    setMembers(memberRefs: ReadonlySet<TypeRef>): void {
        if (this._memberRefs !== undefined) {
            return panic("Can only set map members once");
        }
        this._memberRefs = memberRefs;
    }

    protected getMemberRefs(): ReadonlySet<TypeRef> {
        if (this._memberRefs === undefined) {
            return panic("Map members accessed before they were set");
        }
        return this._memberRefs;
    }

    get members(): ReadonlySet<Type> {
        return setMap(this.getMemberRefs(), tref => derefTypeRef(tref, this.graph));
    }

    get sortedMembers(): ReadonlySet<Type> {
        return this.getNonAttributeChildren();
    }

    getNonAttributeChildren(): Set<Type> {
        // FIXME: We're assuming no two members of the same kind.
        return setSortBy(this.members, t => t.kind);
    }

    isPrimitive(): this is PrimitiveType {
        return false;
    }

    get identity(): MaybeTypeIdentity {
        return setOperationTypeIdentity(this.kind, this.getAttributes(), this.getMemberRefs());
    }

    protected reconstituteSetOperation<T extends BaseGraphRewriteBuilder>(
        builder: TypeReconstituter<T>,
        canonicalOrder: boolean,
        getType: (members: ReadonlySet<TypeRef> | undefined) => void
    ): void {
        const sortedMemberRefs = mapMap(this.sortedMembers.entries(), t => t.typeRef);
        const membersInOrder = canonicalOrder ? this.sortedMembers : this.members;
        const maybeMembers = builder.lookupMap(sortedMemberRefs);
        if (maybeMembers === undefined) {
            getType(undefined);
            const reconstituted = builder.reconstituteMap(sortedMemberRefs);
            builder.setSetOperationMembers(setMap(membersInOrder, t => defined(reconstituted.get(t))));
        } else {
            getType(setMap(membersInOrder, t => defined(maybeMembers.get(t))));
        }
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
    constructor(typeRef: TypeRef, graph: TypeGraph, memberRefs?: ReadonlySet<TypeRef>) {
        super(typeRef, graph, "intersection", memberRefs);
    }

    get isNullable(): boolean {
        return panic("isNullable not implemented for IntersectionType");
    }

    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>, canonicalOrder: boolean): void {
        this.reconstituteSetOperation(builder, canonicalOrder, members => {
            if (members === undefined) {
                builder.getUniqueIntersectionType();
            } else {
                builder.getIntersectionType(members);
            }
        });
    }
}

export class UnionType extends SetOperationType {
    constructor(typeRef: TypeRef, graph: TypeGraph, memberRefs?: ReadonlySet<TypeRef>) {
        super(typeRef, graph, "union", memberRefs);
        if (memberRefs !== undefined) {
            messageAssert(memberRefs.size > 0, "IRNoEmptyUnions", {});
        }
    }

    setMembers(memberRefs: ReadonlySet<TypeRef>): void {
        messageAssert(memberRefs.size > 0, "IRNoEmptyUnions", {});
        super.setMembers(memberRefs);
    }

    get stringTypeMembers(): ReadonlySet<Type> {
        return setFilter(this.members, t => isPrimitiveStringTypeKind(t.kind) || t.kind === "enum");
    }

    findMember(kind: TypeKind): Type | undefined {
        return iterableFind(this.members, t => t.kind === kind);
    }

    get isNullable(): boolean {
        return this.findMember("null") !== undefined;
    }

    get isCanonical(): boolean {
        const members = this.members;
        if (members.size <= 1) return false;
        const kinds = setMap(members, t => t.kind);
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

    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>, canonicalOrder: boolean): void {
        this.reconstituteSetOperation(builder, canonicalOrder, members => {
            if (members === undefined) {
                builder.getUniqueUnionType();
            } else {
                builder.getUnionType(members);
            }
        });
    }
}
