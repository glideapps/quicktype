import { Map, OrderedMap, OrderedSet, Set, is } from "immutable";

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
    ClassProperty,
    IntersectionType,
    ObjectType,
    primitiveTypeIdentity,
    enumTypeIdentity,
    mapTypeIdentify,
    arrayTypeIdentity,
    classTypeIdentity,
    unionTypeIdentity,
    intersectionTypeIdentity,
    MaybeTypeIdentity,
    TypeIdentity
} from "./Type";
import { removeNullFromUnion } from "./TypeUtils";
import { TypeGraph } from "./TypeGraph";
import { TypeAttributes, combineTypeAttributes, TypeAttributeKind, emptyTypeAttributes } from "./TypeAttributes";
import { defined, assert, panic, mapOptional, withDefault } from "./support/Support";
import { stringTypesTypeAttributeKind, StringTypes } from "./StringTypes";
import { EqualityMap } from "./support/Containers";

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

// FIXME: Don't infer provenance.  All original types should be present in
// non-inferred form in the final graph.
class ProvenanceTypeAttributeKind extends TypeAttributeKind<Set<TypeRef>> {
    constructor() {
        super("provenance");
    }

    combine(a: Set<TypeRef>, b: Set<TypeRef>): Set<TypeRef> {
        return a.union(b);
    }

    makeInferred(p: Set<TypeRef>): Set<TypeRef> {
        return p;
    }

    stringify(p: Set<TypeRef>): string {
        return p
            .map(r => r.index)
            .toList()
            .sort()
            .map(i => i.toString())
            .join(",");
    }
}

export const provenanceTypeAttributeKind: TypeAttributeKind<Set<TypeRef>> = new ProvenanceTypeAttributeKind();

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
        readonly canonicalOrder: boolean,
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
            : emptyTypeAttributes;
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
            const index = tref.index;
            this.typeAttributes[index] = combineTypeAttributes("union", this.typeAttributes[index], attributes);
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

    addAttributes(tref: TypeRef, attributes: TypeAttributes): void {
        const index = tref.index;
        const existingAttributes = this.typeAttributes[index];
        assert(
            attributes.every((v, k) => {
                if (!k.inIdentity) return true;
                const existing = existingAttributes.get(k);
                if (existing === undefined) return false;
                return is(existing, v);
            }),
            "Can't add different identity type attributes to an existing type"
        );
        const nonIdentityAttributes = attributes.filterNot((_, k) => k.inIdentity);
        this.typeAttributes[index] = combineTypeAttributes("union", existingAttributes, nonIdentityAttributes);
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

    private readonly _typeForIdentity: EqualityMap<TypeIdentity, TypeRef> = new EqualityMap();

    private registerTypeForIdentity(identity: MaybeTypeIdentity, tref: TypeRef): void {
        if (identity === undefined) return;
        this._typeForIdentity.set(identity, tref);
    }

    protected makeIdentity(maker: () => MaybeTypeIdentity): MaybeTypeIdentity {
        return maker();
    }

    private getOrAddType(
        identityMaker: () => MaybeTypeIdentity,
        creator: (tr: TypeRef) => Type,
        attributes: TypeAttributes | undefined,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        const identity = this.makeIdentity(identityMaker);
        let maybeTypeRef: TypeRef | undefined;
        if (identity === undefined) {
            maybeTypeRef = undefined;
        } else {
            maybeTypeRef = this._typeForIdentity.get(identity);
        }
        if (maybeTypeRef !== undefined) {
            const result = this.forwardIfNecessary(forwardingRef, maybeTypeRef);
            if (attributes !== undefined) {
                // We only add the attributes that are not in the identity, since
                // we found the type based on its identity, i.e. all the identity
                // attributes must be in there already, and we have a check that
                // asserts that no identity attributes are added later.
                this.addAttributes(result, attributes.filter((_, k) => !k.inIdentity));
            }
            return result;
        }

        const tref = this.addType(forwardingRef, creator, attributes);
        this.registerTypeForIdentity(identity, tref);
        return tref;
    }

    private registerType(t: Type): void {
        this.registerTypeForIdentity(t.identity, t.typeRef);
    }

    getPrimitiveType(kind: PrimitiveTypeKind, maybeAttributes?: TypeAttributes, forwardingRef?: TypeRef): TypeRef {
        const attributes = withDefault(maybeAttributes, emptyTypeAttributes);
        // FIXME: Why do date/time types need a StringTypes attribute?
        // FIXME: Remove this from here and put it into flattenStrings
        let stringTypes = kind === "string" ? undefined : StringTypes.unrestricted;
        if (kind === "date") kind = this._stringTypeMapping.date;
        if (kind === "time") kind = this._stringTypeMapping.time;
        if (kind === "date-time") kind = this._stringTypeMapping.dateTime;
        if (kind === "string") {
            return this.getStringType(attributes, stringTypes, forwardingRef);
        }
        return this.getOrAddType(
            () => primitiveTypeIdentity(kind, attributes),
            tr => new PrimitiveType(tr, kind),
            attributes,
            forwardingRef
        );
    }

    getStringType(attributes: TypeAttributes, stringTypes: StringTypes | undefined, forwardingRef?: TypeRef): TypeRef {
        const existingStringTypes = attributes.find((_, k) => k === stringTypesTypeAttributeKind);
        assert(
            (stringTypes === undefined) !== (existingStringTypes === undefined),
            "Must instantiate string type with one enum case attribute"
        );
        if (existingStringTypes === undefined) {
            attributes = combineTypeAttributes(
                "union",
                attributes,
                stringTypesTypeAttributeKind.makeAttributes(defined(stringTypes))
            );
        }
        return this.getOrAddType(
            () => primitiveTypeIdentity("string", attributes),
            tr => new PrimitiveType(tr, "string"),
            attributes,
            forwardingRef
        );
    }

    getEnumType(attributes: TypeAttributes, cases: OrderedSet<string>, forwardingRef?: TypeRef): TypeRef {
        return this.getOrAddType(
            () => enumTypeIdentity(attributes, cases),
            tr => new EnumType(tr, cases),
            attributes,
            forwardingRef
        );
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

    getMapType(attributes: TypeAttributes, values: TypeRef, forwardingRef?: TypeRef): TypeRef {
        return this.getOrAddType(
            () => mapTypeIdentify(attributes, values),
            tr => new MapType(tr, values),
            attributes,
            forwardingRef
        );
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
        this.registerType(type);
    }

    getUniqueArrayType(forwardingRef?: TypeRef): TypeRef {
        return this.addType(forwardingRef, tr => new ArrayType(tr, undefined), undefined);
    }

    getArrayType(items: TypeRef, forwardingRef?: TypeRef): TypeRef {
        return this.getOrAddType(
            () => arrayTypeIdentity(emptyTypeAttributes, items),
            tr => new ArrayType(tr, items),
            undefined,
            forwardingRef
        );
    }

    setArrayItems(ref: TypeRef, items: TypeRef): void {
        const type = ref.deref()[0];
        if (!(type instanceof ArrayType)) {
            return panic("Tried to set items of non-array type");
        }
        type.setItems(items);
        this.registerType(type);
    }

    modifyPropertiesIfNecessary(properties: OrderedMap<string, ClassProperty>): OrderedMap<string, ClassProperty> {
        if (this.canonicalOrder) {
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
        return this.getOrAddType(
            () => classTypeIdentity(attributes, properties),
            tr => new ClassType(tr, false, properties),
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
        forwardingRef?: TypeRef
    ): TypeRef {
        properties = mapOptional(p => this.modifyPropertiesIfNecessary(p), properties);
        return this.addType(forwardingRef, tref => new ClassType(tref, isFixed, properties), attributes);
    }

    getUnionType(attributes: TypeAttributes, members: OrderedSet<TypeRef>, forwardingRef?: TypeRef): TypeRef {
        return this.getOrAddType(
            () => unionTypeIdentity(attributes, members),
            tr => new UnionType(tr, members),
            attributes,
            forwardingRef
        );
    }

    // FIXME: why do we sometimes call this with defined members???
    getUniqueUnionType(
        attributes: TypeAttributes,
        members: OrderedSet<TypeRef> | undefined,
        forwardingRef?: TypeRef
    ): TypeRef {
        return this.addType(forwardingRef, tref => new UnionType(tref, members), attributes);
    }

    getIntersectionType(attributes: TypeAttributes, members: OrderedSet<TypeRef>, forwardingRef?: TypeRef): TypeRef {
        return this.getOrAddType(
            () => intersectionTypeIdentity(attributes, members),
            tr => new IntersectionType(tr, members),
            attributes,
            forwardingRef
        );
    }

    // FIXME: why do we sometimes call this with defined members???
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
        this.registerType(type);
    }

    setLostTypeAttributes(): void {
        return;
    }
}
