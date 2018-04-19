"use strict";

import { Map, OrderedMap, OrderedSet, Set, List } from "immutable";

import {
    PrimitiveTypeKind,
    Type,
    PrimitiveType,
    EnumType,
    MapType,
    ArrayType,
    ClassType,
    UnionType,
    StringType,
    ClassProperty,
    IntersectionType,
    ObjectType,
    Transformation,
    stringTypeIdentity,
    primitiveTypeIdentity,
    enumTypeIdentity,
    mapTypeIdentify,
    arrayTypeIdentity,
    classTypeIdentity,
    unionTypeIdentity,
    intersectionTypeIdentity,
    PlatformTypeKind,
    PlatformType,
    platformTypeIdentity
} from "./Type";
import { removeNullFromUnion } from "./TypeUtils";
import { TypeGraph } from "./TypeGraph";
import { TypeAttributes, combineTypeAttributes, TypeAttributeKind } from "./TypeAttributes";
import { defined, assert, panic, setUnion, mapOptional } from "./Support";

export class TypeRef {
    constructor(readonly graph: TypeGraph, readonly index: number) {}

    deref(): [Type, TypeAttributes] {
        return this.graph.atIndex(this.index);
    }

    equals(other: any): boolean {
        if (!(other instanceof TypeRef)) {
            return false;
        }
        assert(this.graph === other.graph, "Comparing type refs of different graphs");
        return this.index === other.index;
    }

    hashCode(): number {
        return this.index | 0;
    }
}

function provenanceToString(p: Set<TypeRef>): string {
    return p
        .map(r => r.index)
        .toList()
        .sort()
        .map(i => i.toString())
        .join(",");
}

// FIXME: Don't infer provenance.  All original types should be present in
// non-inferred form in the final graph.
export const provenanceTypeAttributeKind = new TypeAttributeKind<Set<TypeRef>>(
    "provenance",
    false,
    setUnion,
    a => a,
    provenanceToString
);

export class TypeBuilder {
    readonly typeGraph: TypeGraph;

    protected topLevels: Map<string, TypeRef> = Map();
    protected readonly types: (Type | undefined)[] = [];
    private readonly typeAttributes: TypeAttributes[] = [];

    private _addedForwardingIntersection: boolean = false;

    constructor(
        readonly alphabetizeProperties: boolean,
        private readonly _allPropertiesOptional: boolean,
        private readonly _addProvenanceAttributes: boolean,
        inheritsProvenanceAttributes: boolean
    ) {
        assert(
            !_addProvenanceAttributes || !inheritsProvenanceAttributes,
            "We can't both inherit as well as add provenance"
        );
        this.typeGraph = new TypeGraph(this, _addProvenanceAttributes || inheritsProvenanceAttributes);
    }

    addTopLevel(name: string, tref: TypeRef): void {
        // assert(t.typeGraph === this.typeGraph, "Adding top-level to wrong type graph");
        assert(!this.topLevels.has(name), "Trying to add top-level with existing name");
        assert(this.types[tref.index] !== undefined, "Trying to add a top-level type that doesn't exist (yet?)");
        this.topLevels = this.topLevels.set(name, tref);
    }

    reserveTypeRef(): TypeRef {
        const index = this.types.length;
        // console.log(`reserving ${index}`);
        this.types.push(undefined);
        const tref = new TypeRef(this.typeGraph, index);
        const attributes: TypeAttributes = this._addProvenanceAttributes
            ? provenanceTypeAttributeKind.makeAttributes(Set([tref]))
            : Map();
        this.typeAttributes.push(attributes);
        return tref;
    }

    private commitType = (tref: TypeRef, t: Type): void => {
        const index = tref.index;
        // const name = names !== undefined ? ` ${names.combinedName}` : "";
        // console.log(`committing ${t.kind}${name} to ${index}`);
        assert(this.types[index] === undefined, "A type index was committed twice");
        this.types[index] = t;
    };

    protected addType<T extends Type>(
        forwardingRef: TypeRef | undefined,
        creator: (tref: TypeRef) => T,
        attributes: TypeAttributes | undefined
    ): TypeRef {
        if (forwardingRef !== undefined) {
            assert(this.types[forwardingRef.index] === undefined);
        }
        const tref = forwardingRef !== undefined ? forwardingRef : this.reserveTypeRef();
        if (attributes !== undefined) {
            this.addAttributes(tref, attributes);
        }
        const t = creator(tref);
        this.commitType(tref, t);
        return tref;
    }

    atIndex(index: number): [Type, TypeAttributes] {
        const maybeType = this.types[index];
        if (maybeType === undefined) {
            return panic("Trying to deref an undefined type in a type builder");
        }
        const maybeNames = this.typeAttributes[index];
        return [maybeType, maybeNames];
    }

    addAttributes(tref: TypeRef, attributes: TypeAttributes | undefined): void {
        if (attributes === undefined) {
            attributes = Map();
        }
        const index = tref.index;
        this.typeAttributes[index] = combineTypeAttributes(this.typeAttributes[index], attributes);
    }

    makeNullable(tref: TypeRef, attributes: TypeAttributes): TypeRef {
        const t = defined(this.types[tref.index]);
        if (t.kind === "null" || t.kind === "any") {
            return tref;
        }
        const nullType = this.getPrimitiveType("null");
        if (!(t instanceof UnionType)) {
            return this.getUnionType(attributes, OrderedSet([tref, nullType]));
        }
        const [maybeNull, nonNulls] = removeNullFromUnion(t);
        if (maybeNull !== null) return tref;
        return this.getUnionType(attributes, nonNulls.map(nn => nn.typeRef).add(nullType));
    }

    finish(): TypeGraph {
        this.typeGraph.freeze(this.topLevels, this.types.map(defined), this.typeAttributes);
        return this.typeGraph;
    }

    protected addForwardingIntersection(forwardingRef: TypeRef, tref: TypeRef): TypeRef {
        this._addedForwardingIntersection = true;
        return this.addType(forwardingRef, tr => new IntersectionType(tr, OrderedSet([tref]), undefined), undefined);
    }

    protected forwardIfNecessary(forwardingRef: TypeRef | undefined, tref: undefined): undefined;
    protected forwardIfNecessary(forwardingRef: TypeRef | undefined, tref: TypeRef): TypeRef;
    protected forwardIfNecessary(forwardingRef: TypeRef | undefined, tref: TypeRef | undefined): TypeRef | undefined;
    protected forwardIfNecessary(forwardingRef: TypeRef | undefined, tref: TypeRef | undefined): TypeRef | undefined {
        if (tref === undefined) return undefined;
        if (forwardingRef === undefined) return tref;
        return this.addForwardingIntersection(forwardingRef, tref);
    }

    get didAddForwardingIntersection(): boolean {
        return this._addedForwardingIntersection;
    }

    // FIXME: make mutable?
    private _typeForIdentity: Map<List<any>, TypeRef> = Map();

    private registerTypeForIdentity(identity: List<any> | undefined, tref: TypeRef): void {
        if (identity === undefined) return;
        this._typeForIdentity = this._typeForIdentity.set(identity, tref);
    }

    private getOrAddType(identity: List<any> | undefined, creator: (tr: TypeRef) => Type, attributes: TypeAttributes | undefined, forwardingRef: TypeRef | undefined): TypeRef {
        let maybeTypeRef: TypeRef | undefined;
        if (identity === undefined) {
            maybeTypeRef = undefined;
        } else {
            maybeTypeRef = this._typeForIdentity.get(identity);
        }
        if (maybeTypeRef !== undefined) {
            const result = this.forwardIfNecessary(forwardingRef, maybeTypeRef);
            this.addAttributes(result, attributes);
            return result;
        }

        const tref = this.addType(forwardingRef, creator, attributes);
        this.registerTypeForIdentity(identity, tref);
        return tref;
    }

    private registerType(t: Type): void {
        this.registerTypeForIdentity(t.identity, t.typeRef);
    }

    getPrimitiveType(kind: PrimitiveTypeKind, transformation?: Transformation, forwardingRef?: TypeRef): TypeRef {
        assert(kind !== "string", "Use getStringType to create strings");
        if (kind === "string") {
            return this.getStringType(undefined, undefined, transformation, forwardingRef);
        }
        return this.getOrAddType(primitiveTypeIdentity(kind, transformation),
            tr => new PrimitiveType(tr, kind, transformation),
            undefined,
            forwardingRef
        );
    }

    getStringType(
        attributes: TypeAttributes | undefined,
        cases: OrderedMap<string, number> | undefined,
        transformation?: Transformation,
        forwardingRef?: TypeRef
    ): TypeRef {
        return this.getOrAddType(
            stringTypeIdentity(cases, transformation),
            tr => new StringType(tr, cases, transformation),
            attributes,
            forwardingRef
        );
    }

    getPlatformType(
        kind: PlatformTypeKind,
        transformation?: Transformation,
        forwardingRef?: TypeRef
    ): TypeRef {
        return this.getOrAddType(
            platformTypeIdentity(kind, transformation),
            tr => new PlatformType(tr, kind, transformation),
            undefined,
            forwardingRef
        );
    }

    getEnumType(attributes: TypeAttributes, cases: OrderedSet<string>, transformation?: Transformation, forwardingRef?: TypeRef): TypeRef {
        return this.getOrAddType(
            enumTypeIdentity(cases, transformation),
            tr => new EnumType(tr, cases, transformation),
            attributes,
            forwardingRef
        );
    }

    getUniqueObjectType(
        attributes: TypeAttributes,
        properties: OrderedMap<string, ClassProperty> | undefined,
        additionalProperties: TypeRef | undefined,
        transformation?: Transformation,
        forwardingRef?: TypeRef
    ): TypeRef {
        properties = mapOptional(p => this.modifyPropertiesIfNecessary(p), properties);
        return this.addType(
            forwardingRef,
            tref => new ObjectType(tref, "object", true, properties, additionalProperties, transformation),
            attributes
        );
    }

    getUniqueMapType(forwardingRef?: TypeRef): TypeRef {
        return this.addType(forwardingRef, tr => new MapType(tr, undefined, undefined), undefined);
    }

    getMapType(values: TypeRef, transformation?: Transformation, forwardingRef?: TypeRef): TypeRef {
        return this.getOrAddType(
            mapTypeIdentify(values, transformation),
            tr => new MapType(tr, values, transformation),
            undefined,
            forwardingRef
        );
    }

    setObjectProperties(
        ref: TypeRef,
        properties: OrderedMap<string, ClassProperty>,
        additionalProperties: TypeRef | undefined,
        transformation?: Transformation
    ): void {
        const type = ref.deref()[0];
        if (!(type instanceof ObjectType)) {
            return panic("Tried to set properties of non-object type");
        }
        type.setProperties(this.modifyPropertiesIfNecessary(properties), additionalProperties, transformation);
        this.registerType(type);
    }

    getUniqueArrayType(forwardingRef?: TypeRef): TypeRef {
        return this.addType(forwardingRef, tr => new ArrayType(tr, undefined, undefined), undefined);
    }

    getArrayType(items: TypeRef, transformation?: Transformation, forwardingRef?: TypeRef): TypeRef {
        return this.getOrAddType(
            arrayTypeIdentity(items, transformation),
            tr => new ArrayType(tr, items, transformation),
            undefined,
            forwardingRef
        );
    }

    setArrayItems(ref: TypeRef, items: TypeRef, transformation?: Transformation): void {
        const type = ref.deref()[0];
        if (!(type instanceof ArrayType)) {
            return panic("Tried to set items of non-array type");
        }
        type.setItems(items, transformation);
        this.registerType(type);
    }

    modifyPropertiesIfNecessary(properties: OrderedMap<string, ClassProperty>): OrderedMap<string, ClassProperty> {
        if (this.alphabetizeProperties) {
            properties = properties.sortBy((_, n) => n);
        }
        if (this._allPropertiesOptional) {
            properties = properties.map(cp => new ClassProperty(cp.typeRef, true));
        }
        return properties;
    }

    getClassType(
        attributes: TypeAttributes,
        properties: OrderedMap<string, ClassProperty>,
        transformation?: Transformation,
        forwardingRef?: TypeRef
    ): TypeRef {
        return this.getOrAddType(
            classTypeIdentity(properties, transformation),
            tr => new ClassType(tr, false, properties, transformation),
            attributes,
            forwardingRef
        );
    }

    // FIXME: Maybe just distinguish between this and `getClassType`
    // via a flag?  That would make `ClassType.map` simpler.
    getUniqueClassType(
        attributes: TypeAttributes,
        isFixed: boolean,
        properties: OrderedMap<string, ClassProperty> | undefined,
        transformation?: Transformation,
        forwardingRef?: TypeRef
    ): TypeRef {
        properties = mapOptional(p => this.modifyPropertiesIfNecessary(p), properties);
        return this.addType(forwardingRef, tref => new ClassType(tref, isFixed, properties, transformation), attributes);
    }

    getUnionType(attributes: TypeAttributes, members: OrderedSet<TypeRef>, transformation?: Transformation, forwardingRef?: TypeRef): TypeRef {
        return this.getOrAddType(
            unionTypeIdentity(members, transformation),
            tr => new UnionType(tr, members, transformation),
            attributes,
            forwardingRef
        );
    }

    // FIXME: why do we sometimes call this with defined members???
    getUniqueUnionType(
        attributes: TypeAttributes,
        members: OrderedSet<TypeRef> | undefined,
        transformation?: Transformation,
        forwardingRef?: TypeRef
    ): TypeRef {
        return this.addType(forwardingRef, tref => new UnionType(tref, members, transformation), attributes);
    }

    getIntersectionType(attributes: TypeAttributes, members: OrderedSet<TypeRef>, transformation?: Transformation, forwardingRef?: TypeRef): TypeRef {
        return this.getOrAddType(
            intersectionTypeIdentity(members, transformation),
            tr => new IntersectionType(tr, members, transformation),
            attributes,
            forwardingRef
        );
    }

    // FIXME: why do we sometimes call this with defined members???
    getUniqueIntersectionType(
        attributes: TypeAttributes,
        members: OrderedSet<TypeRef> | undefined,
        transformation?: Transformation,
        forwardingRef?: TypeRef
    ): TypeRef {
        return this.addType(forwardingRef, tref => new IntersectionType(tref, members, transformation), attributes);
    }

    setSetOperationMembers(ref: TypeRef, members: OrderedSet<TypeRef>, transformation?: Transformation): void {
        const type = ref.deref()[0];
        if (!(type instanceof UnionType || type instanceof IntersectionType)) {
            return panic("Tried to set members of non-set-operation type");
        }
        type.setMembers(members, transformation);
        this.registerType(type);
    }

    setLostTypeAttributes(): void {
        return;
    }
}
