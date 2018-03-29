"use strict";

import { Map, OrderedMap, OrderedSet, Set } from "immutable";

import {
    PrimitiveTypeKind,
    Type,
    PrimitiveType,
    EnumType,
    MapType,
    ArrayType,
    ClassType,
    UnionType,
    removeNullFromUnion,
    PrimitiveStringTypeKind,
    StringType,
    ClassProperty,
    TypeKind,
    matchTypeExhaustive,
    IntersectionType,
    ObjectType
} from "./Type";
import { TypeGraph } from "./TypeGraph";
import {
    TypeAttributes,
    combineTypeAttributes,
    TypeAttributeKind,
    emptyTypeAttributes,
    makeTypeAttributesInferred
} from "./TypeAttributes";
import { defined, assert, panic, assertNever, setUnion } from "./Support";

export type TypeRefCallback = (index: number) => void;

export class TypeRef {
    private _maybeIndexOrRef?: number | TypeRef;
    private _callbacks?: TypeRefCallback[];

    constructor(readonly graph: TypeGraph, index?: number, private _allocatingTypeBuilder?: TypeBuilder) {
        this._maybeIndexOrRef = index;
    }

    private follow(): TypeRef {
        if (this._maybeIndexOrRef instanceof TypeRef) {
            return this._maybeIndexOrRef.follow();
        }
        return this;
    }

    get maybeIndex(): number | undefined {
        const tref = this.follow();
        if (typeof tref._maybeIndexOrRef === "number") {
            return tref._maybeIndexOrRef;
        }
        return undefined;
    }

    getIndex(): number {
        const maybeIndex = this.maybeIndex;
        if (maybeIndex === undefined) {
            const tref = this.follow();
            if (tref._allocatingTypeBuilder !== undefined) {
                const allocated = tref._allocatingTypeBuilder.reserveTypeRef();
                assert(allocated.follow() !== this, "Tried to create a TypeRef cycle");
                tref._maybeIndexOrRef = allocated;
                tref._allocatingTypeBuilder = undefined;
                return allocated.getIndex();
            }

            return panic("Trying to dereference unresolved type reference");
        }
        return maybeIndex;
    }

    callWhenResolved(callback: TypeRefCallback): void {
        if (this._maybeIndexOrRef === undefined) {
            if (this._callbacks === undefined) {
                this._callbacks = [];
            }
            this._callbacks.push(callback);
        } else if (typeof this._maybeIndexOrRef === "number") {
            callback(this._maybeIndexOrRef);
        } else {
            this._maybeIndexOrRef.callWhenResolved(callback);
        }
    }

    resolve(tref: TypeRef): void {
        if (this._maybeIndexOrRef !== undefined) {
            assert(
                this.maybeIndex === tref.maybeIndex,
                "Trying to resolve an allocated type reference with an incompatible one"
            );
        }
        assert(tref.follow() !== this, "Tried to create a TypeRef cycle");
        this._maybeIndexOrRef = tref.follow();
        this._allocatingTypeBuilder = undefined;
        if (this._callbacks !== undefined) {
            for (const cb of this._callbacks) {
                tref.callWhenResolved(cb);
            }
            this._callbacks = undefined;
        }
    }

    deref(): [Type, TypeAttributes] {
        return this.graph.atIndex(this.getIndex());
    }

    equals(other: any): boolean {
        if (!(other instanceof TypeRef)) {
            return false;
        }
        assert(this.graph === other.graph, "Comparing type refs of different graphs");
        return this.follow() === other.follow();
    }

    hashCode(): number {
        return this.getIndex() | 0;
    }
}

function provenanceToString(p: Set<TypeRef>): string {
    return p
        .map(r => r.getIndex())
        .toList()
        .sort()
        .map(i => i.toString())
        .join(",");
}

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
        assert(this.types[tref.getIndex()] !== undefined, "Trying to add a top-level type that doesn't exist (yet?)");
        this.topLevels = this.topLevels.set(name, tref);
    }

    reserveTypeRef(): TypeRef {
        const index = this.types.length;
        // console.log(`reserving ${index}`);
        this.types.push(undefined);
        const tref = new TypeRef(this.typeGraph, index, undefined);
        const attributes: TypeAttributes = this._addProvenanceAttributes
            ? provenanceTypeAttributeKind.makeAttributes(Set([tref]))
            : Map();
        this.typeAttributes.push(attributes);
        return tref;
    }

    private commitType = (tref: TypeRef, t: Type): void => {
        const index = tref.getIndex();
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
        if (forwardingRef !== undefined && forwardingRef.maybeIndex !== undefined) {
            assert(this.types[forwardingRef.maybeIndex] === undefined);
        }
        const tref =
            forwardingRef !== undefined && forwardingRef.maybeIndex !== undefined
                ? forwardingRef
                : this.reserveTypeRef();
        if (attributes !== undefined) {
            this.addAttributes(tref, attributes);
        }
        const t = creator(tref);
        this.commitType(tref, t);
        if (forwardingRef !== undefined && tref !== forwardingRef) {
            forwardingRef.resolve(tref);
        }
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
        tref.callWhenResolved(index => {
            if (attributes === undefined) {
                attributes = Map();
            }
            this.typeAttributes[index] = combineTypeAttributes(this.typeAttributes[index], attributes);
        });
    }

    makeNullable(tref: TypeRef, attributes: TypeAttributes): TypeRef {
        const t = defined(this.types[tref.getIndex()]);
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

    // FIXME: make mutable?
    private _primitiveTypes: Map<PrimitiveTypeKind, TypeRef> = Map();
    private _noEnumStringType: TypeRef | undefined = undefined;
    private _mapTypes: Map<TypeRef, TypeRef> = Map();
    private _arrayTypes: Map<TypeRef, TypeRef> = Map();
    private _enumTypes: Map<Set<string>, TypeRef> = Map();
    private _classTypes: Map<Map<string, ClassProperty>, TypeRef> = Map();
    private _unionTypes: Map<Set<TypeRef>, TypeRef> = Map();

    getPrimitiveType(kind: PrimitiveTypeKind, forwardingRef?: TypeRef): TypeRef {
        assert(kind !== "string", "Use getStringType to create strings");
        if (kind === "date") kind = this._stringTypeMapping.date;
        if (kind === "time") kind = this._stringTypeMapping.time;
        if (kind === "date-time") kind = this._stringTypeMapping.dateTime;
        if (kind === "string") {
            return this.getStringType(undefined, undefined, forwardingRef);
        }
        let tref = this._primitiveTypes.get(kind);
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
            if (this._noEnumStringType === undefined) {
                this._noEnumStringType = this.addType(forwardingRef, tr => new StringType(tr, undefined), undefined);
            }
            this.addAttributes(this._noEnumStringType, attributes);
            return this._noEnumStringType;
        }
        return this.addType(forwardingRef, tr => new StringType(tr, cases), attributes);
    }

    getEnumType(attributes: TypeAttributes, cases: OrderedSet<string>, forwardingRef?: TypeRef): TypeRef {
        const unorderedCases = cases.toSet();
        let tref = this._enumTypes.get(unorderedCases);
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
        properties: OrderedMap<string, ClassProperty>,
        additionalProperties: TypeRef | undefined,
        forwardingRef?: TypeRef
    ): TypeRef {
        properties = this.modifyPropertiesIfNecessary(properties);
        return this.addType(
            forwardingRef,
            tref => new ObjectType(tref, "object", true, properties, additionalProperties),
            attributes
        );
    }

    getMapType(values: TypeRef, forwardingRef?: TypeRef): TypeRef {
        let tref = this._mapTypes.get(values);
        if (tref === undefined) {
            tref = this.addType(forwardingRef, tr => new MapType(tr, values), undefined);
            this._mapTypes = this._mapTypes.set(values, tref);
        }
        return tref;
    }

    getArrayType(items: TypeRef, forwardingRef?: TypeRef): TypeRef {
        let tref = this._arrayTypes.get(items);
        if (tref === undefined) {
            tref = this.addType(forwardingRef, tr => new ArrayType(tr, items), undefined);
            this._arrayTypes = this._arrayTypes.set(items, tref);
        }
        return tref;
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
        let tref = this._classTypes.get(properties.toMap());
        // FIXME: It's not clear to me that the `forwardingRef` condition here
        // might actually ever be true.  And if it can, shouldn't we also have
        // it in all the other `getXXX` methods here?
        if ((forwardingRef !== undefined && forwardingRef.maybeIndex !== undefined) || tref === undefined) {
            tref = this.addType(forwardingRef, tr => new ClassType(tr, false, properties), attributes);
            this._classTypes = this._classTypes.set(properties.toMap(), tref);
        } else {
            this.addAttributes(tref, attributes);
        }
        return tref;
    }

    // FIXME: Maybe just distinguish between this and `getClassType`
    // via a flag?  That would make `ClassType.map` simpler.
    getUniqueClassType(
        attributes: TypeAttributes,
        isFixed: boolean,
        properties: OrderedMap<string, ClassProperty>,
        forwardingRef?: TypeRef
    ): TypeRef {
        properties = this.modifyPropertiesIfNecessary(properties);
        return this.addType(forwardingRef, tref => new ClassType(tref, isFixed, properties), attributes);
    }

    getUnionType(attributes: TypeAttributes, members: OrderedSet<TypeRef>, forwardingRef?: TypeRef): TypeRef {
        const unorderedMembers = members.toSet();
        let tref = this._unionTypes.get(unorderedMembers);
        if (tref === undefined) {
            tref = this.addType(forwardingRef, tr => new UnionType(tr, members), attributes);
            this._unionTypes = this._unionTypes.set(unorderedMembers, tref);
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
    }

    setLostTypeAttributes(): void {
        return;
    }
}

export interface TypeLookerUp {
    lookupTypeRefs(typeRefs: TypeRef[], forwardingRef?: TypeRef): TypeRef | undefined;
    reconstituteTypeRef(typeRef: TypeRef, forwardingRef?: TypeRef): TypeRef;
    registerUnion(typeRefs: TypeRef[], reconstituted: TypeRef): void;
}

export class TypeReconstituter {
    private _wasUsed: boolean = false;

    constructor(
        private readonly _typeBuilder: TypeBuilder,
        private readonly _makeClassUnique: boolean,
        private readonly _typeAttributes: TypeAttributes,
        private readonly _forwardingRef: TypeRef
    ) {}

    private useBuilder(): TypeBuilder {
        assert(!this._wasUsed, "TypeReconstituter used more than once");
        this._wasUsed = true;
        return this._typeBuilder;
    }

    private addAttributes(tref: TypeRef): TypeRef {
        this._typeBuilder.addAttributes(tref, this._typeAttributes);
        return tref;
    }

    getPrimitiveType(kind: PrimitiveTypeKind): TypeRef {
        return this.addAttributes(this.useBuilder().getPrimitiveType(kind, this._forwardingRef));
    }

    getStringType(enumCases: OrderedMap<string, number> | undefined): TypeRef {
        return this.useBuilder().getStringType(this._typeAttributes, enumCases, this._forwardingRef);
    }

    getEnumType(cases: OrderedSet<string>): TypeRef {
        return this.useBuilder().getEnumType(defined(this._typeAttributes), cases, this._forwardingRef);
    }

    getMapType(values: TypeRef): TypeRef {
        return this.addAttributes(this.useBuilder().getMapType(values, this._forwardingRef));
    }

    getArrayType(items: TypeRef): TypeRef {
        return this.addAttributes(this.useBuilder().getArrayType(items, this._forwardingRef));
    }

    getUniqueObjectType(
        properties: OrderedMap<string, ClassProperty>,
        additionalProperties: TypeRef | undefined
    ): TypeRef {
        return this.addAttributes(
            this.useBuilder().getUniqueObjectType(defined(this._typeAttributes), properties, additionalProperties)
        );
    }

    getClassType(properties: OrderedMap<string, ClassProperty>): TypeRef {
        if (this._makeClassUnique) {
            return this.getUniqueClassType(false, properties);
        }
        return this.useBuilder().getClassType(defined(this._typeAttributes), properties, this._forwardingRef);
    }

    getUniqueClassType(isFixed: boolean, properties: OrderedMap<string, ClassProperty>): TypeRef {
        return this.useBuilder().getUniqueClassType(
            defined(this._typeAttributes),
            isFixed,
            properties,
            this._forwardingRef
        );
    }

    getUnionType(members: OrderedSet<TypeRef>): TypeRef {
        return this.useBuilder().getUnionType(defined(this._typeAttributes), members, this._forwardingRef);
    }

    getUniqueIntersectionType(members: OrderedSet<TypeRef>): TypeRef {
        return this.useBuilder().getUniqueIntersectionType(defined(this._typeAttributes), members, this._forwardingRef);
    }
}

export class GraphRewriteBuilder<T extends Type> extends TypeBuilder implements TypeLookerUp {
    private _setsToReplaceByMember: Map<number, Set<T>>;
    private _reconstitutedTypes: Map<number, TypeRef> = Map();
    private _reconstitutedUnions: Map<Set<TypeRef>, TypeRef> = Map();

    private _lostTypeAttributes: boolean = false;

    constructor(
        private readonly _originalGraph: TypeGraph,
        stringTypeMapping: StringTypeMapping,
        alphabetizeProperties: boolean,
        graphHasProvenanceAttributes: boolean,
        setsToReplace: T[][],
        private readonly _replacer: (
            typesToReplace: Set<T>,
            builder: GraphRewriteBuilder<T>,
            forwardingRef: TypeRef
        ) => TypeRef
    ) {
        super(stringTypeMapping, alphabetizeProperties, false, false, graphHasProvenanceAttributes);
        this._setsToReplaceByMember = Map();
        for (const types of setsToReplace) {
            const set = Set(types);
            set.forEach(t => {
                const index = t.typeRef.getIndex();
                assert(!this._setsToReplaceByMember.has(index), "A type is member of more than one set to be replaced");
                this._setsToReplaceByMember = this._setsToReplaceByMember.set(index, set);
            });
        }
    }

    registerUnion(typeRefs: TypeRef[], reconstituted: TypeRef): void {
        const set = Set(typeRefs);
        assert(!this._reconstitutedUnions.has(set), "Cannot register reconstituted set twice");
        this._reconstitutedUnions = this._reconstitutedUnions.set(set, reconstituted);
    }

    followIndex(index: number): number {
        const entry = this.types[index];
        if (typeof entry === "number") {
            return this.followIndex(entry);
        }
        return index;
    }

    protected typeForEntry(entry: Type | undefined | number): Type | undefined {
        if (typeof entry === "number") {
            entry = this.types[this.followIndex(entry)];
            if (typeof entry === "number") {
                return panic("followIndex led us to a forwarding entry");
            }
        }
        return entry;
    }

    withForwardingRef(
        maybeForwardingRef: TypeRef | undefined,
        typeCreator: (forwardingRef: TypeRef) => TypeRef
    ): TypeRef {
        if (maybeForwardingRef !== undefined) {
            return typeCreator(maybeForwardingRef);
        }

        const forwardingRef = new TypeRef(this.typeGraph, undefined, this);
        const actualRef = typeCreator(forwardingRef);
        forwardingRef.resolve(actualRef);
        return actualRef;
    }

    private replaceSet(typesToReplace: Set<T>, maybeForwardingRef: TypeRef | undefined): TypeRef {
        return this.withForwardingRef(maybeForwardingRef, forwardingRef => {
            typesToReplace.forEach(t => {
                const originalRef = t.typeRef;
                const index = originalRef.getIndex();
                this._reconstitutedTypes = this._reconstitutedTypes.set(index, forwardingRef);
                this._setsToReplaceByMember = this._setsToReplaceByMember.remove(index);
            });
            return this._replacer(typesToReplace, this, forwardingRef);
        });
    }

    private forceReconstituteTypeRef(originalRef: TypeRef, maybeForwardingRef?: TypeRef): TypeRef {
        return this.withForwardingRef(maybeForwardingRef, (forwardingRef: TypeRef): TypeRef => {
            this._reconstitutedTypes = this._reconstitutedTypes.set(originalRef.getIndex(), forwardingRef);
            const [originalType, originalNames] = originalRef.deref();
            return originalType.map(
                new TypeReconstituter(this, this.alphabetizeProperties, originalNames, forwardingRef),
                (ref: TypeRef) => this.reconstituteTypeRef(ref)
            );
        });
    }

    private assertTypeRefsToReconstitute(typeRefs: TypeRef[], forwardingRef?: TypeRef): void {
        for (const originalRef of typeRefs) {
            assert(originalRef.graph === this._originalGraph, "Trying to reconstitute a type from the wrong graph");
        }
        if (forwardingRef !== undefined) {
            assert(forwardingRef.graph === this.typeGraph, "Trying to forward a type to the wrong graph");
        }
    }

    reconstituteTypeRef(originalRef: TypeRef, maybeForwardingRef?: TypeRef): TypeRef {
        const maybeRef = this.lookupTypeRefs([originalRef], maybeForwardingRef);
        if (maybeRef !== undefined) {
            return maybeRef;
        }
        return this.forceReconstituteTypeRef(originalRef, maybeForwardingRef);
    }

    reconstituteType(t: Type, forwardingRef?: TypeRef): TypeRef {
        return this.reconstituteTypeRef(t.typeRef, forwardingRef);
    }

    // If the union of these type refs have been, or are supposed to be, reconstituted to
    // one target type, return it.  Otherwise return undefined.
    lookupTypeRefs(typeRefs: TypeRef[], forwardingRef?: TypeRef): TypeRef | undefined {
        this.assertTypeRefsToReconstitute(typeRefs, forwardingRef);

        // Check whether we have already reconstituted them.  That means ensuring
        // that they all have the same target type.
        let maybeRef = this._reconstitutedTypes.get(typeRefs[0].getIndex());
        if (maybeRef !== undefined && maybeRef !== forwardingRef) {
            let allEqual = true;
            for (let i = 1; i < typeRefs.length; i++) {
                if (this._reconstitutedTypes.get(typeRefs[i].getIndex()) !== maybeRef) {
                    allEqual = false;
                    break;
                }
            }
            if (allEqual) {
                if (forwardingRef !== undefined) {
                    forwardingRef.resolve(maybeRef);
                }
                return maybeRef;
            }
        }

        // Has this been reconstituted as a set?
        maybeRef = this._reconstitutedUnions.get(Set(typeRefs));
        if (maybeRef !== undefined && maybeRef !== forwardingRef) {
            if (forwardingRef !== undefined) {
                forwardingRef.resolve(maybeRef);
            }
            return maybeRef;
        }

        // Is this set requested to be replaced?  If not, we're out of options.
        const maybeSet = this._setsToReplaceByMember.get(typeRefs[0].getIndex());
        if (maybeSet === undefined) {
            return undefined;
        }
        for (let i = 1; i < typeRefs.length; i++) {
            if (this._setsToReplaceByMember.get(typeRefs[i].getIndex()) !== maybeSet) {
                return undefined;
            }
        }
        // Yes, this set is requested to be replaced, so do it.
        return this.replaceSet(maybeSet, forwardingRef);
    }

    finish(): TypeGraph {
        this._originalGraph.topLevels.forEach((t, name) => {
            this.addTopLevel(name, this.reconstituteType(t));
        });
        return super.finish();
    }

    setLostTypeAttributes(): void {
        this._lostTypeAttributes = true;
    }

    get lostTypeAttributes(): boolean {
        return this._lostTypeAttributes;
    }
}

// FIXME: This interface is badly designed.  All the properties
// should use immutable types, and getMemberKinds should be
// implementable using the interface, not be part of it.  That
// means we'll have to expose primitive types, too.
//
// FIXME: Also, only UnionAccumulator seems to implement it.
export interface UnionTypeProvider<TArrayData, TObjectData> {
    readonly arrayData: TArrayData;
    readonly objectData: TObjectData;
    // FIXME: We're losing order here.
    enumCaseMap: { [name: string]: number };
    enumCases: string[];

    getMemberKinds(): TypeAttributeMap<TypeKind>;

    readonly lostTypeAttributes: boolean;
}

export type TypeAttributeMap<T extends TypeKind> = OrderedMap<T, TypeAttributes>;

function addAttributes(
    accumulatorAttributes: TypeAttributes | undefined,
    newAttributes: TypeAttributes
): TypeAttributes {
    if (accumulatorAttributes === undefined) return newAttributes;
    return combineTypeAttributes(accumulatorAttributes, newAttributes);
}

function setAttributes<T extends TypeKind>(
    attributeMap: TypeAttributeMap<T>,
    kind: T,
    newAttributes: TypeAttributes
): TypeAttributeMap<T> {
    return attributeMap.set(kind, addAttributes(attributeMap.get(kind), newAttributes));
}

function moveAttributes<T extends TypeKind>(map: TypeAttributeMap<T>, fromKind: T, toKind: T): TypeAttributeMap<T> {
    const fromAttributes = defined(map.get(fromKind));
    map = map.remove(fromKind);
    return setAttributes(map, toKind, fromAttributes);
}

export class UnionAccumulator<TArray, TObject> implements UnionTypeProvider<TArray[], TObject[]> {
    private _nonStringTypeAttributes: TypeAttributeMap<TypeKind> = OrderedMap();
    private _stringTypeAttributes: TypeAttributeMap<PrimitiveStringTypeKind | "enum"> = OrderedMap();

    readonly arrayData: TArray[] = [];
    readonly objectData: TObject[] = [];

    private _lostTypeAttributes: boolean = false;

    // FIXME: we're losing order here
    enumCaseMap: { [name: string]: number } = {};
    enumCases: string[] = [];

    constructor(private readonly _conflateNumbers: boolean) {}

    private have(kind: TypeKind): boolean {
        return (
            this._nonStringTypeAttributes.has(kind) || this._stringTypeAttributes.has(kind as PrimitiveStringTypeKind)
        );
    }

    get haveString(): boolean {
        return this.have("string");
    }

    addAny(attributes: TypeAttributes): void {
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "any", attributes);
        this._lostTypeAttributes = true;
    }
    addNull(attributes: TypeAttributes): void {
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "null", attributes);
    }
    addBool(attributes: TypeAttributes): void {
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "bool", attributes);
    }
    addInteger(attributes: TypeAttributes): void {
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "integer", attributes);
    }
    addDouble(attributes: TypeAttributes): void {
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "double", attributes);
    }

    addStringType(kind: PrimitiveStringTypeKind, attributes: TypeAttributes): void {
        if (this.have(kind)) {
            this._stringTypeAttributes = setAttributes(this._stringTypeAttributes, kind, attributes);
            return;
        }
        // string overrides all other string types, as well as enum
        if (kind === "string") {
            const oldAttributes = combineTypeAttributes(this._stringTypeAttributes.valueSeq().toArray());
            const newAttributes = addAttributes(oldAttributes, attributes);
            this._stringTypeAttributes = this._stringTypeAttributes.clear().set(kind, newAttributes);

            this.enumCaseMap = {};
            this.enumCases = [];
        } else {
            this._stringTypeAttributes = setAttributes(this._stringTypeAttributes, kind, attributes);
        }
    }
    addArray(t: TArray, attributes: TypeAttributes): void {
        this.arrayData.push(t);
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "array", attributes);
    }
    addObject(t: TObject, attributes: TypeAttributes): void {
        this.objectData.push(t);
        this._nonStringTypeAttributes = setAttributes(this._nonStringTypeAttributes, "object", attributes);
    }

    addEnumCases(cases: OrderedMap<string, number>, attributes: TypeAttributes): void {
        if (this.have("string")) {
            this.addStringType("string", attributes);
            return;
        }

        cases.forEach((count, s) => {
            if (!Object.prototype.hasOwnProperty.call(this.enumCaseMap, s)) {
                this.enumCaseMap[s] = 0;
                this.enumCases.push(s);
            }
            this.enumCaseMap[s] += count;
        });

        this._stringTypeAttributes = setAttributes(this._stringTypeAttributes, "enum", attributes);
    }
    addEnumCase(s: string, count: number, attributes: TypeAttributes): void {
        this.addEnumCases(OrderedMap([[s, count] as [string, number]]), attributes);
    }

    getMemberKinds(): TypeAttributeMap<TypeKind> {
        let merged = this._nonStringTypeAttributes.merge(this._stringTypeAttributes);
        if (merged.isEmpty()) {
            return OrderedMap([["none", Map()] as [TypeKind, TypeAttributes]]);
        }

        if (this._nonStringTypeAttributes.has("any")) {
            assert(this._lostTypeAttributes, "This had to be set when we added 'any'");

            const allAttributes = combineTypeAttributes(merged.valueSeq().toArray());
            return OrderedMap([["any", allAttributes] as [TypeKind, TypeAttributes]]);
        }

        if (this._conflateNumbers && this.have("integer") && this.have("double")) {
            merged = moveAttributes(merged, "integer", "double");
        }
        if (this.have("map")) {
            merged = moveAttributes(merged, "map", "class");
        }
        return merged;
    }

    get lostTypeAttributes(): boolean {
        return this._lostTypeAttributes;
    }
}

class FauxUnion {
    getAttributes(): TypeAttributes {
        return emptyTypeAttributes;
    }
}

function attributesForTypes(types: Set<Type>): [OrderedMap<Type, TypeAttributes>, TypeAttributes] {
    let unionsForType: OrderedMap<Type, Set<UnionType | FauxUnion>> = OrderedMap();
    let typesForUnion: Map<UnionType | FauxUnion, Set<Type>> = Map();
    let unions: OrderedSet<UnionType> = OrderedSet();
    let unionsEquivalentToRoot: Set<UnionType> = Set();
    function traverse(t: Type, path: Set<UnionType | FauxUnion>, isEquivalentToRoot: boolean): void {
        if (t instanceof UnionType) {
            unions = unions.add(t);
            if (isEquivalentToRoot) {
                unionsEquivalentToRoot = unionsEquivalentToRoot.add(t);
            }

            path = path.add(t);
            isEquivalentToRoot = isEquivalentToRoot && t.members.size === 1;
            t.members.forEach(m => traverse(m, path, isEquivalentToRoot));
        } else {
            unionsForType = unionsForType.update(t, Set(), s => s.union(path));
            path.forEach(u => {
                typesForUnion = typesForUnion.update(u, Set(), s => s.add(t));
            });
        }
    }

    const rootPath = Set([new FauxUnion()]);
    types.forEach(t => traverse(t, rootPath, types.size === 1));

    const resultAttributes = unionsForType.map((unionForType, t) => {
        const singleAncestors = unionForType.filter(u => defined(typesForUnion.get(u)).size === 1);
        assert(singleAncestors.every(u => defined(typesForUnion.get(u)).has(t)), "We messed up bookkeeping");
        const inheritedAttributes = singleAncestors.toArray().map(u => u.getAttributes());
        return combineTypeAttributes([t.getAttributes()].concat(inheritedAttributes));
    });
    const unionAttributes = unions.toArray().map(u => {
        const t = typesForUnion.get(u);
        if (t !== undefined && t.size === 1) {
            return emptyTypeAttributes;
        }
        const attributes = u.getAttributes();
        if (unionsEquivalentToRoot.has(u)) {
            return attributes;
        }
        return makeTypeAttributesInferred(attributes);
    });
    return [resultAttributes, combineTypeAttributes(unionAttributes)];
}

// FIXME: Move this to UnifyClasses.ts?
export class TypeRefUnionAccumulator extends UnionAccumulator<TypeRef, TypeRef> {
    // There is a method analogous to this in the IntersectionAccumulator.  It might
    // make sense to find a common interface.
    private addType(t: Type, attributes: TypeAttributes): void {
        matchTypeExhaustive(
            t,
            _noneType => {
                return;
            },
            _anyType => this.addAny(attributes),
            _nullType => this.addNull(attributes),
            _boolType => this.addBool(attributes),
            _integerType => this.addInteger(attributes),
            _doubleType => this.addDouble(attributes),
            stringType => {
                const enumCases = stringType.enumCases;
                if (enumCases === undefined) {
                    this.addStringType("string", attributes);
                } else {
                    this.addEnumCases(enumCases, attributes);
                }
            },
            arrayType => this.addArray(arrayType.items.typeRef, attributes),
            classType => this.addObject(classType.typeRef, attributes),
            mapType => this.addObject(mapType.typeRef, attributes),
            objectType => this.addObject(objectType.typeRef, attributes),
            // FIXME: We're not carrying counts, so this is not correct if we do enum
            // inference.  JSON Schema input uses this case, however, without enum
            // inference, which is fine, but still a bit ugly.
            enumType => this.addEnumCases(enumType.cases.toOrderedMap().map(_ => 1), attributes),
            _unionType => {
                return panic("The unions should have been eliminated in attributesForTypesInUnion");
            },
            _dateType => this.addStringType("date", attributes),
            _timeType => this.addStringType("time", attributes),
            _dateTimeType => this.addStringType("date-time", attributes)
        );
    }

    addTypes(types: Set<Type>): TypeAttributes {
        const [attributesMap, unionAttributes] = attributesForTypes(types);
        attributesMap.forEach((attributes, t) => this.addType(t, attributes));
        return unionAttributes;
    }
}

export abstract class UnionBuilder<TBuilder extends TypeBuilder, TArrayData, TObjectData> {
    constructor(protected readonly typeBuilder: TBuilder) {}

    protected abstract makeEnum(
        cases: string[],
        counts: { [name: string]: number },
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef;
    protected abstract makeObject(
        objects: TObjectData,
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef;
    protected abstract makeArray(
        arrays: TArrayData,
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef;

    private makeTypeOfKind(
        typeProvider: UnionTypeProvider<TArrayData, TObjectData>,
        kind: TypeKind,
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        switch (kind) {
            case "any":
            case "none":
            case "null":
            case "bool":
            case "double":
            case "integer":
            case "date":
            case "time":
            case "date-time":
                const t = this.typeBuilder.getPrimitiveType(kind, forwardingRef);
                this.typeBuilder.addAttributes(t, typeAttributes);
                return t;
            case "string":
                return this.typeBuilder.getStringType(typeAttributes, undefined, forwardingRef);
            case "enum":
                return this.makeEnum(typeProvider.enumCases, typeProvider.enumCaseMap, typeAttributes, forwardingRef);
            case "object":
                return this.makeObject(typeProvider.objectData, typeAttributes, forwardingRef);
            case "array":
                return this.makeArray(typeProvider.arrayData, typeAttributes, forwardingRef);
            default:
                if (kind === "union" || kind === "class" || kind === "map" || kind === "intersection") {
                    return panic(`getMemberKinds() shouldn't return ${kind}`);
                }
                return assertNever(kind);
        }
    }

    buildUnion(
        typeProvider: UnionTypeProvider<TArrayData, TObjectData>,
        unique: boolean,
        typeAttributes: TypeAttributes,
        forwardingRef?: TypeRef
    ): TypeRef {
        const kinds = typeProvider.getMemberKinds();

        if (typeProvider.lostTypeAttributes) {
            this.typeBuilder.setLostTypeAttributes();
        }

        if (kinds.size === 1) {
            const [[kind, memberAttributes]] = kinds.toArray();
            const allAttributes = combineTypeAttributes(typeAttributes, memberAttributes);
            const t = this.makeTypeOfKind(typeProvider, kind, allAttributes, forwardingRef);
            return t;
        }

        const union = unique
            ? this.typeBuilder.getUniqueUnionType(typeAttributes, undefined, forwardingRef)
            : undefined;

        const types: TypeRef[] = [];
        kinds.forEach((memberAttributes, kind) => {
            types.push(this.makeTypeOfKind(typeProvider, kind, memberAttributes, undefined));
        });
        const typesSet = OrderedSet(types);
        if (union !== undefined) {
            this.typeBuilder.setSetOperationMembers(union, typesSet);
            return union;
        } else {
            return this.typeBuilder.getUnionType(typeAttributes, typesSet, forwardingRef);
        }
    }
}
