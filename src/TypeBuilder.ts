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
    PrimitiveStringTypeKind,
    StringType,
    ClassProperty,
    IntersectionType,
    ObjectType,
    TransformedType,
    Transformer
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
    setUnion,
    a => a,
    provenanceToString
);

export type StringTypeMapping = {
    date: PrimitiveStringTypeKind;
    time: PrimitiveStringTypeKind;
    dateTime: PrimitiveStringTypeKind;
};

export const NoStringTypeMapping: StringTypeMapping = {
    date: "date",
    time: "time",
    dateTime: "date-time"
};

export class TypeBuilder {
    readonly typeGraph: TypeGraph;

    protected topLevels: Map<string, TypeRef> = Map();
    protected readonly types: (Type | undefined)[] = [];
    private readonly typeAttributes: TypeAttributes[] = [];

    private _addedForwardingIntersection: boolean = false;

    constructor(
        private readonly _stringTypeMapping: StringTypeMapping,
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
        return this.addType(forwardingRef, tr => new IntersectionType(tr, OrderedSet([tref])), undefined);
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
    private _primitiveTypes: Map<PrimitiveTypeKind, TypeRef> = Map();
    private _noEnumStringType: TypeRef | undefined = undefined;
    // FIXME: Combine map and object type maps
    private _mapTypes: Map<TypeRef, TypeRef> = Map();
    private _arrayTypes: Map<TypeRef, TypeRef> = Map();
    private _enumTypes: Map<Set<string>, TypeRef> = Map();
    private _classTypes: Map<Map<string, ClassProperty>, TypeRef> = Map();
    private _unionTypes: Map<Set<TypeRef>, TypeRef> = Map();
    private _intersectionTypes: Map<Set<TypeRef>, TypeRef> = Map();
    private _transformedTypes: Map<List<any>, TypeRef> = Map();

    getPrimitiveType(kind: PrimitiveTypeKind, forwardingRef?: TypeRef): TypeRef {
        assert(kind !== "string", "Use getStringType to create strings");
        if (kind === "date") kind = this._stringTypeMapping.date;
        if (kind === "time") kind = this._stringTypeMapping.time;
        if (kind === "date-time") kind = this._stringTypeMapping.dateTime;
        if (kind === "string") {
            return this.getStringType(undefined, undefined, forwardingRef);
        }
        let tref = this.forwardIfNecessary(forwardingRef, this._primitiveTypes.get(kind));
        if (tref === undefined) {
            tref = this.addType(forwardingRef, tr => new PrimitiveType(tr, kind), undefined);
            this._primitiveTypes = this._primitiveTypes.set(kind, tref);
        }
        return tref;
    }

    getStringType(
        attributes: TypeAttributes | undefined,
        cases: OrderedMap<string, number> | undefined,
        forwardingRef?: TypeRef
    ): TypeRef {
        if (cases === undefined) {
            // FIXME: Right now we completely ignore names for strings
            // without enum cases.  That's the correct behavior at the time,
            // because string types never are assigned names, but we might
            // do that at some point, but in that case we'll want a different
            // type for each occurrence, not the same single string type with
            // all the names.
            //
            // The proper solution at that point might be to just figure
            // out whether we do want string types to have names (we most
            // likely don't), and if not, still don't keep track of them.
            let result: TypeRef;
            if (this._noEnumStringType === undefined) {
                result = this._noEnumStringType = this.addType(
                    forwardingRef,
                    tr => new StringType(tr, undefined),
                    undefined
                );
            } else {
                result = this.forwardIfNecessary(forwardingRef, this._noEnumStringType);
            }
            this.addAttributes(this._noEnumStringType, attributes);
            return result;
        }
        return this.addType(forwardingRef, tr => new StringType(tr, cases), attributes);
    }

    getEnumType(attributes: TypeAttributes, cases: OrderedSet<string>, forwardingRef?: TypeRef): TypeRef {
        const unorderedCases = cases.toSet();
        let tref = this.forwardIfNecessary(forwardingRef, this._enumTypes.get(unorderedCases));
        if (tref === undefined) {
            tref = this.addType(forwardingRef, tr => new EnumType(tr, cases), attributes);
            this._enumTypes = this._enumTypes.set(unorderedCases, tref);
        } else {
            this.addAttributes(tref, attributes);
        }
        return tref;
    }

    getUniqueObjectType(
        attributes: TypeAttributes,
        properties: OrderedMap<string, ClassProperty> | undefined,
        additionalProperties: TypeRef | undefined,
        forwardingRef?: TypeRef
    ): TypeRef {
        properties = mapOptional(p => this.modifyPropertiesIfNecessary(p), properties);
        return this.addType(
            forwardingRef,
            tref => new ObjectType(tref, "object", true, properties, additionalProperties),
            attributes
        );
    }

    getUniqueMapType(forwardingRef?: TypeRef): TypeRef {
        return this.addType(forwardingRef, tr => new MapType(tr, undefined), undefined);
    }

    private registerMapType(values: TypeRef, tref: TypeRef): void {
        if (this._mapTypes.has(values)) return;
        this._mapTypes = this._mapTypes.set(values, tref);
    }

    getMapType(values: TypeRef, forwardingRef?: TypeRef): TypeRef {
        let tref = this.forwardIfNecessary(forwardingRef, this._mapTypes.get(values));
        if (tref === undefined) {
            tref = this.addType(forwardingRef, tr => new MapType(tr, values), undefined);
            this.registerMapType(values, tref);
        }
        return tref;
    }

    private registerClassType(properties: OrderedMap<string, ClassProperty>, tref: TypeRef): void {
        const map = properties.toMap();
        this._classTypes = this._classTypes.set(map, tref);
    }

    setObjectProperties(
        ref: TypeRef,
        properties: OrderedMap<string, ClassProperty>,
        additionalProperties: TypeRef | undefined
    ): void {
        const type = ref.deref()[0];
        if (!(type instanceof ObjectType)) {
            return panic("Tried to set properties of non-object type");
        }
        type.setProperties(this.modifyPropertiesIfNecessary(properties), additionalProperties);
        if (type instanceof MapType) {
            this.registerMapType(defined(additionalProperties), ref);
        } else if (type instanceof ClassType) {
            if (!type.isFixed) {
                this.registerClassType(properties, ref);
            }
        }
    }

    getUniqueArrayType(forwardingRef?: TypeRef): TypeRef {
        return this.addType(forwardingRef, tr => new ArrayType(tr, undefined), undefined);
    }

    private registerArrayType(items: TypeRef, tref: TypeRef): void {
        if (this._arrayTypes.has(items)) return;
        this._arrayTypes = this._arrayTypes.set(items, tref);
    }

    getArrayType(items: TypeRef, forwardingRef?: TypeRef): TypeRef {
        let tref = this.forwardIfNecessary(forwardingRef, this._arrayTypes.get(items));
        if (tref === undefined) {
            tref = this.addType(forwardingRef, tr => new ArrayType(tr, items), undefined);
            this.registerArrayType(items, tref);
        }
        return tref;
    }

    setArrayItems(ref: TypeRef, items: TypeRef): void {
        const type = ref.deref()[0];
        if (!(type instanceof ArrayType)) {
            return panic("Tried to set items of non-array type");
        }
        type.setItems(items);
        this.registerArrayType(items, ref);
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
        forwardingRef?: TypeRef
    ): TypeRef {
        properties = this.modifyPropertiesIfNecessary(properties);
        let tref = this.forwardIfNecessary(forwardingRef, this._classTypes.get(properties.toMap()));
        if (tref === undefined) {
            tref = this.addType(forwardingRef, tr => new ClassType(tr, false, properties), attributes);
            this.registerClassType(properties, tref);
        } else {
            this.addAttributes(tref, attributes);
        }
        return tref;
    }

    private registerUnionType(members: Set<TypeRef>, tref: TypeRef): void {
        if (this._unionTypes.has(members)) return;
        this._unionTypes = this._unionTypes.set(members, tref);
    }

    // FIXME: Maybe just distinguish between this and `getClassType`
    // via a flag?  That would make `ClassType.map` simpler.
    getUniqueClassType(
        attributes: TypeAttributes,
        isFixed: boolean,
        properties: OrderedMap<string, ClassProperty> | undefined,
        forwardingRef?: TypeRef
    ): TypeRef {
        properties = mapOptional(p => this.modifyPropertiesIfNecessary(p), properties);
        return this.addType(forwardingRef, tref => new ClassType(tref, isFixed, properties), attributes);
    }

    getUnionType(attributes: TypeAttributes, members: OrderedSet<TypeRef>, forwardingRef?: TypeRef): TypeRef {
        const unorderedMembers = members.toSet();
        let tref = this.forwardIfNecessary(forwardingRef, this._unionTypes.get(unorderedMembers));
        if (tref === undefined) {
            tref = this.addType(forwardingRef, tr => new UnionType(tr, members), attributes);
            this.registerUnionType(unorderedMembers, tref);
        } else {
            this.addAttributes(tref, attributes);
        }
        return tref;
    }

    getUniqueUnionType(
        attributes: TypeAttributes,
        members: OrderedSet<TypeRef> | undefined,
        forwardingRef?: TypeRef
    ): TypeRef {
        return this.addType(forwardingRef, tref => new UnionType(tref, members), attributes);
    }

    private registerIntersectionType(members: Set<TypeRef>, tref: TypeRef): void {
        if (this._intersectionTypes.has(members)) return;
        this._intersectionTypes = this._intersectionTypes.set(members, tref);
    }

    getIntersectionType(attributes: TypeAttributes, members: OrderedSet<TypeRef>, forwardingRef?: TypeRef): TypeRef {
        const unorderedMembers = members.toSet();
        let tref = this.forwardIfNecessary(forwardingRef, this._intersectionTypes.get(unorderedMembers));
        if (tref === undefined) {
            tref = this.addType(forwardingRef, tr => new IntersectionType(tr, members), attributes);
            this.registerIntersectionType(unorderedMembers, tref);
        } else {
            this.addAttributes(tref, attributes);
        }
        return tref;
    }

    getUniqueIntersectionType(
        attributes: TypeAttributes,
        members: OrderedSet<TypeRef> | undefined,
        forwardingRef?: TypeRef
    ): TypeRef {
        return this.addType(forwardingRef, tref => new IntersectionType(tref, members), attributes);
    }

    setSetOperationMembers(ref: TypeRef, members: OrderedSet<TypeRef>): void {
        const type = ref.deref()[0];
        if (!(type instanceof UnionType || type instanceof IntersectionType)) {
            return panic("Tried to set members of non-set-operation type");
        }
        type.setMembers(members);
        const unorderedMembers = members.toSet();
        if (type instanceof UnionType) {
            this.registerUnionType(unorderedMembers, ref);
        } else if (type instanceof IntersectionType) {
            this.registerIntersectionType(unorderedMembers, ref);
        } else {
            return panic("Unknown set operation type ${type.kind}");
        }
    }

    setLostTypeAttributes(): void {
        return;
    }

    private registerTransformedType(
        transformer: Transformer,
        sourceRef: TypeRef,
        targetRef: TypeRef,
        tref: TypeRef
    ): void {
        const key = List([transformer, sourceRef, targetRef]);
        if (this._transformedTypes.has(key)) return;
        this._transformedTypes = this._transformedTypes.set(key, tref);
    }

    getTransformedType(
        attributes: TypeAttributes,
        transformer: Transformer,
        sourceRef: TypeRef,
        targetRef: TypeRef,
        forwardingRef?: TypeRef
    ): TypeRef {
        const key = List([transformer, sourceRef, targetRef]);
        let tref = this.forwardIfNecessary(forwardingRef, this._transformedTypes.get(key));
        if (tref === undefined) {
            tref = this.addType(
                forwardingRef,
                tr => new TransformedType(tr, transformer, sourceRef, targetRef),
                attributes
            );
            this.registerTransformedType(transformer, sourceRef, targetRef, tref);
        } else {
            this.addAttributes(tref, attributes);
        }
        return tref;
    }

    getUniqueTransformedType(attributes: TypeAttributes, transformer: Transformer, forwardingRef?: TypeRef): TypeRef {
        return this.addType(forwardingRef, tref => new TransformedType(tref, transformer), attributes);
    }

    setTransformedTypeTypes(ref: TypeRef, sourceRef: TypeRef, targetRef: TypeRef): void {
        const type = ref.deref()[0];
        if (!(type instanceof TransformedType)) {
            return panic("Tried to set types of non-transformed type");
        }

        type.setTypes(sourceRef, targetRef);
        this.registerTransformedType(type.transformer, sourceRef, targetRef, ref);
    }
}
