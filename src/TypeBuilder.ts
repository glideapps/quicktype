"use strict";

import { Map, OrderedMap, OrderedSet, Set, Collection, isCollection } from "immutable";

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
    ObjectType,
    combineTypeAttributesOfTypes
} from "./Type";
import { TypeGraph } from "./TypeGraph";
import {
    TypeAttributes,
    combineTypeAttributes,
    TypeAttributeKind,
    emptyTypeAttributes,
    makeTypeAttributesInferred
} from "./TypeAttributes";
import { defined, assert, panic, assertNever, setUnion, mapOptional } from "./Support";

// FIXME: Get rid of this eventually
export class TypeRef {
    constructor(readonly graph: TypeGraph, readonly maybeIndex: number) {}

    getIndex(): number {
        return this.maybeIndex;
    }

    deref(): [Type, TypeAttributes] {
        return this.graph.atIndex(this.getIndex());
    }

    equals(other: any): boolean {
        if (!(other instanceof TypeRef)) {
            return false;
        }
        assert(this.graph === other.graph, "Comparing type refs of different graphs");
        return this.maybeIndex === other.maybeIndex;
    }

    hashCode(): number {
        return this.maybeIndex | 0;
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
        assert(this.types[tref.getIndex()] !== undefined, "Trying to add a top-level type that doesn't exist (yet?)");
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
        const index = tref.getIndex();
        this.typeAttributes[index] = combineTypeAttributes(this.typeAttributes[index], attributes);
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
}

export interface TypeLookerUp {
    lookupTypeRefs(typeRefs: TypeRef[], forwardingRef?: TypeRef): TypeRef | undefined;
    reconstituteTypeRef(typeRef: TypeRef, forwardingRef?: TypeRef): TypeRef;
}

export class TypeReconstituter<TBuilder extends BaseGraphRewriteBuilder> {
    private _wasUsed: boolean = false;
    private _typeRef: TypeRef | undefined = undefined;

    constructor(
        private readonly _typeBuilder: TBuilder,
        private readonly _makeClassUnique: boolean,
        private readonly _typeAttributes: TypeAttributes,
        private readonly _forwardingRef: TypeRef | undefined,
        private readonly _register: (tref: TypeRef) => void
    ) {}

    private builderForNewType(): TBuilder {
        assert(!this._wasUsed, "TypeReconstituter used more than once");
        this._wasUsed = true;
        return this._typeBuilder;
    }

    private builderForSetting(): TBuilder {
        assert(this._wasUsed && this._typeRef !== undefined, "Can't set type members before constructing a type");
        return this._typeBuilder;
    }

    getResult(): TypeRef {
        if (this._typeRef === undefined) {
            return panic("Type was not reconstituted");
        }
        return this._typeRef;
    }

    // FIXME: Do registration automatically.
    private register(tref: TypeRef): void {
        assert(this._typeRef === undefined, "Cannot register a type twice");
        this._typeRef = tref;
        this._register(tref);
    }

    private registerAndAddAttributes(tref: TypeRef): void {
        this._typeBuilder.addAttributes(tref, this._typeAttributes);
        this.register(tref);
    }

    lookup(tref: TypeRef): TypeRef | undefined;
    lookup<C extends Collection<any, TypeRef>>(trefs: C): C | undefined;
    lookup<C extends Collection<any, TypeRef>>(trefs: TypeRef | C): TypeRef | C | undefined {
        assert(!this._wasUsed, "Cannot lookup constituents after building type");
        if (isCollection(trefs)) {
            const maybeRefs = trefs.map(tref => this._typeBuilder.lookupTypeRefs([tref], undefined, false));
            if (maybeRefs.some(tref => tref === undefined)) return undefined;
            return maybeRefs as C;
        }
        return this._typeBuilder.lookupTypeRefs([trefs], undefined, false);
    }

    reconstitute(tref: TypeRef): TypeRef;
    reconstitute<C extends Collection<any, TypeRef>>(trefs: C): C;
    reconstitute<C extends Collection<any, TypeRef>>(trefs: TypeRef | C): TypeRef | C {
        assert(this._wasUsed, "Cannot reconstitute constituents before building type");
        if (isCollection(trefs)) {
            return trefs.map(tref => this._typeBuilder.reconstituteTypeRef(tref)) as C;
        }
        return this._typeBuilder.reconstituteTypeRef(trefs);
    }

    getPrimitiveType(kind: PrimitiveTypeKind): void {
        this.registerAndAddAttributes(this.builderForNewType().getPrimitiveType(kind, this._forwardingRef));
    }

    getStringType(enumCases: OrderedMap<string, number> | undefined): void {
        this.register(this.builderForNewType().getStringType(this._typeAttributes, enumCases, this._forwardingRef));
    }

    getEnumType(cases: OrderedSet<string>): void {
        this.register(this.builderForNewType().getEnumType(this._typeAttributes, cases, this._forwardingRef));
    }

    getUniqueMapType(): void {
        this.registerAndAddAttributes(this.builderForNewType().getUniqueMapType(this._forwardingRef));
    }

    getMapType(values: TypeRef): void {
        this.registerAndAddAttributes(this.builderForNewType().getMapType(values, this._forwardingRef));
    }

    getUniqueArrayType(): void {
        this.registerAndAddAttributes(this.builderForNewType().getUniqueArrayType(this._forwardingRef));
    }

    getArrayType(items: TypeRef): void {
        this.registerAndAddAttributes(this.builderForNewType().getArrayType(items, this._forwardingRef));
    }

    setArrayItems(items: TypeRef): void {
        this.builderForSetting().setArrayItems(this.getResult(), items);
    }

    getObjectType(properties: OrderedMap<string, ClassProperty>, additionalProperties: TypeRef | undefined): void {
        this.register(
            this.builderForNewType().getUniqueObjectType(
                this._typeAttributes,
                properties,
                additionalProperties,
                this._forwardingRef
            )
        );
    }

    getUniqueObjectType(
        properties: OrderedMap<string, ClassProperty> | undefined,
        additionalProperties: TypeRef | undefined
    ): void {
        this.register(
            this.builderForNewType().getUniqueObjectType(
                this._typeAttributes,
                properties,
                additionalProperties,
                this._forwardingRef
            )
        );
    }

    getClassType(properties: OrderedMap<string, ClassProperty>): void {
        if (this._makeClassUnique) {
            this.getUniqueClassType(false, properties);
            return;
        }
        this.register(this.builderForNewType().getClassType(this._typeAttributes, properties, this._forwardingRef));
    }

    getUniqueClassType(isFixed: boolean, properties: OrderedMap<string, ClassProperty> | undefined): void {
        this.register(
            this.builderForNewType().getUniqueClassType(this._typeAttributes, isFixed, properties, this._forwardingRef)
        );
    }

    setObjectProperties(
        properties: OrderedMap<string, ClassProperty>,
        additionalProperties: TypeRef | undefined
    ): void {
        this.builderForSetting().setObjectProperties(this.getResult(), properties, additionalProperties);
    }

    getUnionType(members: OrderedSet<TypeRef>): void {
        this.register(this.builderForNewType().getUnionType(this._typeAttributes, members, this._forwardingRef));
    }

    getUniqueUnionType(): void {
        this.register(
            this.builderForNewType().getUniqueUnionType(this._typeAttributes, undefined, this._forwardingRef)
        );
    }

    getIntersectionType(members: OrderedSet<TypeRef>): void {
        this.register(this.builderForNewType().getIntersectionType(this._typeAttributes, members, this._forwardingRef));
    }

    getUniqueIntersectionType(members?: OrderedSet<TypeRef>): void {
        this.register(
            this.builderForNewType().getUniqueIntersectionType(this._typeAttributes, members, this._forwardingRef)
        );
    }

    setSetOperationMembers(members: OrderedSet<TypeRef>): void {
        this.builderForSetting().setSetOperationMembers(this.getResult(), members);
    }
}

export abstract class BaseGraphRewriteBuilder extends TypeBuilder implements TypeLookerUp {
    protected reconstitutedTypes: Map<number, TypeRef> = Map();

    private _lostTypeAttributes: boolean = false;
    private _printIndent = 0;

    constructor(
        protected readonly originalGraph: TypeGraph,
        stringTypeMapping: StringTypeMapping,
        alphabetizeProperties: boolean,
        graphHasProvenanceAttributes: boolean,
        protected readonly debugPrint: boolean
    ) {
        super(stringTypeMapping, alphabetizeProperties, false, false, graphHasProvenanceAttributes);
    }

    reconstituteType(t: Type, forwardingRef?: TypeRef): TypeRef {
        return this.reconstituteTypeRef(t.typeRef, forwardingRef);
    }

    abstract lookupTypeRefs(typeRefs: TypeRef[], forwardingRef?: TypeRef, replaceSet?: boolean): TypeRef | undefined;
    protected abstract forceReconstituteTypeRef(originalRef: TypeRef, maybeForwardingRef?: TypeRef): TypeRef;

    reconstituteTypeRef(originalRef: TypeRef, maybeForwardingRef?: TypeRef): TypeRef {
        const maybeRef = this.lookupTypeRefs([originalRef], maybeForwardingRef);
        if (maybeRef !== undefined) {
            return maybeRef;
        }
        return this.forceReconstituteTypeRef(originalRef, maybeForwardingRef);
    }

    protected assertTypeRefsToReconstitute(typeRefs: TypeRef[], forwardingRef?: TypeRef): void {
        assert(typeRefs.length > 0, "Must have at least one type to reconstitute");
        for (const originalRef of typeRefs) {
            assert(originalRef.graph === this.originalGraph, "Trying to reconstitute a type from the wrong graph");
        }
        if (forwardingRef !== undefined) {
            assert(forwardingRef.graph === this.typeGraph, "Trying to forward a type to the wrong graph");
        }
    }

    protected changeDebugPrintIndent(delta: number): void {
        this._printIndent += delta;
    }

    protected get debugPrintIndentation(): string {
        return "  ".repeat(this._printIndent);
    }

    finish(): TypeGraph {
        this.originalGraph.topLevels.forEach((t, name) => {
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

export class GraphRemapBuilder extends BaseGraphRewriteBuilder {
    private _attributeSources: Map<Type, Type[]> = Map();

    constructor(
        originalGraph: TypeGraph,
        stringTypeMapping: StringTypeMapping,
        alphabetizeProperties: boolean,
        graphHasProvenanceAttributes: boolean,
        private readonly _map: Map<Type, Type>,
        debugPrintRemapping: boolean
    ) {
        super(
            originalGraph,
            stringTypeMapping,
            alphabetizeProperties,
            graphHasProvenanceAttributes,
            debugPrintRemapping
        );

        _map.forEach((target, source) => {
            let maybeSources = this._attributeSources.get(target);
            if (maybeSources === undefined) {
                maybeSources = [target];
                this._attributeSources = this._attributeSources.set(target, maybeSources);
            }
            maybeSources.push(source);
        });
    }

    private getMapTarget(tref: TypeRef): TypeRef {
        const maybeType = this._map.get(tref.deref()[0]);
        if (maybeType === undefined) return tref;
        assert(this._map.get(maybeType) === undefined, "We have a type that's remapped to a remapped type");
        return maybeType.typeRef;
    }

    protected addForwardingIntersection(_forwardingRef: TypeRef, _tref: TypeRef): TypeRef {
        return panic("We can't add forwarding intersections when we're removing forwarding intersections");
    }

    lookupTypeRefs(typeRefs: TypeRef[], forwardingRef?: TypeRef): TypeRef | undefined {
        assert(forwardingRef === undefined, "We can't have a forwarding ref when we remap");

        this.assertTypeRefsToReconstitute(typeRefs, forwardingRef);

        const first = this.reconstitutedTypes.get(this.getMapTarget(typeRefs[0]).getIndex());
        if (first === undefined) return undefined;

        for (let i = 1; i < typeRefs.length; i++) {
            const other = this.reconstitutedTypes.get(this.getMapTarget(typeRefs[i]).getIndex());
            if (first !== other) return undefined;
        }

        return first;
    }

    protected forceReconstituteTypeRef(originalRef: TypeRef, maybeForwardingRef?: TypeRef): TypeRef {
        assert(maybeForwardingRef === undefined, "We can't have a forwarding ref when we remap");

        originalRef = this.getMapTarget(originalRef);
        const [originalType, originalAttributes] = originalRef.deref();

        const attributeSources = this._attributeSources.get(originalType);
        let attributes: TypeAttributes;
        if (attributeSources === undefined) {
            attributes = originalAttributes;
        } else {
            attributes = combineTypeAttributesOfTypes(attributeSources);
        }

        const index = originalRef.getIndex();

        if (this.debugPrint) {
            console.log(`${this.debugPrintIndentation}reconstituting ${index}`);
            this.changeDebugPrintIndent(1);
        }

        const reconstituter = new TypeReconstituter(this, this.alphabetizeProperties, attributes, undefined, tref => {
            if (this.debugPrint) {
                this.changeDebugPrintIndent(-1);
                console.log(`${this.debugPrintIndentation}reconstituted ${index} as ${tref.getIndex()}`);
            }

            const alreadyReconstitutedType = this.reconstitutedTypes.get(index);
            if (alreadyReconstitutedType !== undefined) {
                return panic("We can't remap a type twice");
            }
            this.reconstitutedTypes = this.reconstitutedTypes.set(index, tref);
        });
        originalType.reconstitute(reconstituter);
        return reconstituter.getResult();
    }
}

export class GraphRewriteBuilder<T extends Type> extends BaseGraphRewriteBuilder {
    private _setsToReplaceByMember: Map<number, Set<T>>;
    private _reconstitutedUnions: Map<Set<TypeRef>, TypeRef> = Map();

    constructor(
        originalGraph: TypeGraph,
        stringTypeMapping: StringTypeMapping,
        alphabetizeProperties: boolean,
        graphHasProvenanceAttributes: boolean,
        setsToReplace: T[][],
        debugPrintReconstitution: boolean,
        private readonly _replacer: (
            typesToReplace: Set<T>,
            builder: GraphRewriteBuilder<T>,
            forwardingRef: TypeRef
        ) => TypeRef
    ) {
        super(
            originalGraph,
            stringTypeMapping,
            alphabetizeProperties,
            graphHasProvenanceAttributes,
            debugPrintReconstitution
        );

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

    withForwardingRef(
        maybeForwardingRef: TypeRef | undefined,
        typeCreator: (forwardingRef: TypeRef) => TypeRef
    ): TypeRef {
        if (maybeForwardingRef !== undefined) {
            return typeCreator(maybeForwardingRef);
        }

        const forwardingRef = this.reserveTypeRef();
        const actualRef = typeCreator(forwardingRef);
        assert(actualRef === forwardingRef, "Type creator didn't return its forwarding ref");
        return actualRef;
    }

    private replaceSet(typesToReplace: Set<T>, maybeForwardingRef: TypeRef | undefined): TypeRef {
        return this.withForwardingRef(maybeForwardingRef, forwardingRef => {
            if (this.debugPrint) {
                console.log(
                    `${this.debugPrintIndentation}replacing set ${typesToReplace
                        .map(t => t.typeRef.getIndex().toString())
                        .join(",")} as ${forwardingRef.getIndex()}`
                );
                this.changeDebugPrintIndent(1);
            }

            typesToReplace.forEach(t => {
                const originalRef = t.typeRef;
                const index = originalRef.getIndex();
                this.reconstitutedTypes = this.reconstitutedTypes.set(index, forwardingRef);
                this._setsToReplaceByMember = this._setsToReplaceByMember.remove(index);
            });
            const result = this._replacer(typesToReplace, this, forwardingRef);
            assert(result === forwardingRef, "The forwarding ref got lost when replacing");

            if (this.debugPrint) {
                this.changeDebugPrintIndent(-1);
                console.log(
                    `${this.debugPrintIndentation}replaced set ${typesToReplace
                        .map(t => t.typeRef.getIndex().toString)
                        .join(",")} as ${forwardingRef.getIndex()}`
                );
            }

            return result;
        });
    }

    protected forceReconstituteTypeRef(originalRef: TypeRef, maybeForwardingRef?: TypeRef): TypeRef {
        const [originalType, originalAttributes] = originalRef.deref();
        const index = originalRef.getIndex();

        if (this.debugPrint) {
            console.log(`${this.debugPrintIndentation}reconstituting ${index}`);
            this.changeDebugPrintIndent(1);
        }

        const reconstituter = new TypeReconstituter(
            this,
            this.alphabetizeProperties,
            originalAttributes,
            maybeForwardingRef,
            tref => {
                if (this.debugPrint) {
                    this.changeDebugPrintIndent(-1);
                    console.log(`${this.debugPrintIndentation}reconstituted ${index} as ${tref.getIndex()}`);
                }

                if (maybeForwardingRef !== undefined) {
                    assert(tref === maybeForwardingRef, "We didn't pass the forwarding ref");
                }

                const alreadyReconstitutedType = this.reconstitutedTypes.get(index);
                if (alreadyReconstitutedType === undefined) {
                    this.reconstitutedTypes = this.reconstitutedTypes.set(index, tref);
                } else {
                    assert(tref.equals(alreadyReconstitutedType), "We reconstituted a type twice differently");
                    if (maybeForwardingRef === undefined) {
                        return panic("Why do we reconstitute a type twice???");
                    }
                }
            }
        );
        originalType.reconstitute(reconstituter);
        return reconstituter.getResult();
    }

    // If the union of these type refs have been, or are supposed to be, reconstituted to
    // one target type, return it.  Otherwise return undefined.
    lookupTypeRefs(typeRefs: TypeRef[], forwardingRef?: TypeRef, replaceSet: boolean = true): TypeRef | undefined {
        this.assertTypeRefsToReconstitute(typeRefs, forwardingRef);

        // Check whether we have already reconstituted them.  That means ensuring
        // that they all have the same target type.
        let maybeRef = this.reconstitutedTypes.get(typeRefs[0].getIndex());
        if (maybeRef !== undefined && maybeRef !== forwardingRef) {
            let allEqual = true;
            for (let i = 1; i < typeRefs.length; i++) {
                if (this.reconstitutedTypes.get(typeRefs[i].getIndex()) !== maybeRef) {
                    allEqual = false;
                    break;
                }
            }
            if (allEqual) {
                return this.forwardIfNecessary(forwardingRef, maybeRef);
            }
        }

        // Has this been reconstituted as a set?
        maybeRef = this._reconstitutedUnions.get(Set(typeRefs));
        if (maybeRef !== undefined && maybeRef !== forwardingRef) {
            return this.forwardIfNecessary(forwardingRef, maybeRef);
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
        if (!replaceSet) return undefined;
        return this.replaceSet(maybeSet, forwardingRef);
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
