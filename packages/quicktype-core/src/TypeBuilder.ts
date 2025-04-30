import {
    EqualityMap,
    areEqual,
    definedMap,
    iterableEvery,
    mapFilter,
    mapFind,
    mapMap,
    mapSortByKey,
    setUnionManyInto,
    withDefault
} from "collection-utils";

// eslint-disable-next-line import/no-cycle
import { StringTypes, stringTypesTypeAttributeKind } from "./attributes/StringTypes";
import {
    TypeAttributeKind,
    type TypeAttributes,
    combineTypeAttributes,
    emptyTypeAttributes
} from "./attributes/TypeAttributes";
import { assert, defined, panic } from "./support/Support";
// eslint-disable-next-line import/no-cycle
import {
    ArrayType,
    ClassProperty,
    ClassType,
    EnumType,
    IntersectionType,
    MapType,
    type MaybeTypeIdentity,
    ObjectType,
    PrimitiveType,
    type Type,
    type TypeIdentity,
    UnionType,
    arrayTypeIdentity,
    classTypeIdentity,
    enumTypeIdentity,
    intersectionTypeIdentity,
    mapTypeIdentify,
    primitiveTypeIdentity,
    unionTypeIdentity
} from "./Type";
import {
    type PrimitiveStringTypeKind,
    type PrimitiveTypeKind,
    type TransformedStringTypeKind,
    type TypeKind,
    isPrimitiveStringTypeKind,
    transformedStringTypeKinds
} from "./Type/utils";
// eslint-disable-next-line import/no-cycle
import { TypeGraph, type TypeRef, assertTypeRefGraph, derefTypeRef, makeTypeRef, typeRefIndex } from "./TypeGraph";

// FIXME: Don't infer provenance.  All original types should be present in
// non-inferred form in the final graph.
class ProvenanceTypeAttributeKind extends TypeAttributeKind<Set<number>> {
    public constructor() {
        super("provenance");
    }

    public appliesToTypeKind(_kind: TypeKind): boolean {
        return true;
    }

    public combine(arr: Array<Set<number>>): Set<number> {
        return setUnionManyInto(new Set(), arr);
    }

    public makeInferred(p: Set<number>): Set<number> {
        return p;
    }

    public stringify(p: Set<number>): string {
        return Array.from(p)
            .sort()
            .map(i => i.toString())
            .join(",");
    }
}

export const provenanceTypeAttributeKind: TypeAttributeKind<Set<number>> = new ProvenanceTypeAttributeKind();

export type StringTypeMapping = ReadonlyMap<TransformedStringTypeKind, PrimitiveStringTypeKind>;

export function stringTypeMappingGet(stm: StringTypeMapping, kind: TransformedStringTypeKind): PrimitiveStringTypeKind {
    const mapped = stm.get(kind);
    if (mapped === undefined) return "string";
    return mapped;
}

let noStringTypeMapping: StringTypeMapping | undefined;

export function getNoStringTypeMapping(): StringTypeMapping {
    if (noStringTypeMapping === undefined) {
        noStringTypeMapping = new Map(
            Array.from(transformedStringTypeKinds).map(
                k => [k, k] as [TransformedStringTypeKind, PrimitiveStringTypeKind]
            )
        );
    }

    return noStringTypeMapping;
}

export class TypeBuilder {
    public readonly typeGraph: TypeGraph;

    protected readonly topLevels: Map<string, TypeRef> = new Map();

    protected readonly types: Array<Type | undefined> = [];

    private readonly typeAttributes: TypeAttributes[] = [];

    private _addedForwardingIntersection = false;

    public constructor(
        typeGraphSerial: number,
        private readonly _stringTypeMapping: StringTypeMapping,
        public readonly canonicalOrder: boolean,
        private readonly _allPropertiesOptional: boolean,
        private readonly _addProvenanceAttributes: boolean,
        inheritsProvenanceAttributes: boolean
    ) {
        assert(
            !_addProvenanceAttributes || !inheritsProvenanceAttributes,
            "We can't both inherit as well as add provenance"
        );
        this.typeGraph = new TypeGraph(this, typeGraphSerial, _addProvenanceAttributes || inheritsProvenanceAttributes);
    }

    public addTopLevel(name: string, tref: TypeRef): void {
        // assert(t.typeGraph === this.typeGraph, "Adding top-level to wrong type graph");
        assert(!this.topLevels.has(name), "Trying to add top-level with existing name");
        assert(
            this.types[typeRefIndex(tref)] !== undefined,
            "Trying to add a top-level type that doesn't exist (yet?)"
        );
        this.topLevels.set(name, tref);
    }

    public reserveTypeRef(): TypeRef {
        const index = this.types.length;
        // console.log(`reserving ${index}`);
        this.types.push(undefined);
        const tref = makeTypeRef(this.typeGraph, index);
        const attributes: TypeAttributes = this._addProvenanceAttributes
            ? provenanceTypeAttributeKind.makeAttributes(new Set([index]))
            : emptyTypeAttributes;
        this.typeAttributes.push(attributes);
        return tref;
    }

    private assertTypeRefGraph(tref: TypeRef | undefined): void {
        if (tref === undefined) return;
        assertTypeRefGraph(tref, this.typeGraph);
    }

    private assertTypeRefSetGraph(trefs: ReadonlySet<TypeRef> | undefined): void {
        if (trefs === undefined) return;
        trefs.forEach(tref => this.assertTypeRefGraph(tref));
    }

    private filterTypeAttributes(t: Type, attributes: TypeAttributes): TypeAttributes {
        const filtered = mapFilter(attributes, (_, k) => k.appliesToTypeKind(t.kind));
        if (attributes.size !== filtered.size) {
            this.setLostTypeAttributes();
        }

        return filtered;
    }

    private commitType(tref: TypeRef, t: Type): void {
        this.assertTypeRefGraph(tref);
        const index = typeRefIndex(tref);
        // const name = names !== undefined ? ` ${names.combinedName}` : "";
        // console.log(`committing ${t.kind}${name} to ${index}`);
        assert(this.types[index] === undefined, "A type index was committed twice");
        this.types[index] = t;
        this.typeAttributes[index] = this.filterTypeAttributes(t, this.typeAttributes[index]);
    }

    protected addType<T extends Type>(
        forwardingRef: TypeRef | undefined,
        creator: (tref: TypeRef) => T,
        attributes: TypeAttributes | undefined
    ): TypeRef {
        if (forwardingRef !== undefined) {
            this.assertTypeRefGraph(forwardingRef);
            assert(this.types[typeRefIndex(forwardingRef)] === undefined);
        }

        const tref = forwardingRef ?? this.reserveTypeRef();
        if (attributes !== undefined) {
            const index = typeRefIndex(tref);
            this.typeAttributes[index] = combineTypeAttributes("union", this.typeAttributes[index], attributes);
        }

        const t = creator(tref);
        this.commitType(tref, t);
        return tref;
    }

    public typeAtIndex(index: number): Type {
        const maybeType = this.types[index];
        if (maybeType === undefined) {
            return panic("Trying to deref an undefined type in a type builder");
        }

        return maybeType;
    }

    public atIndex(index: number): [Type, TypeAttributes] {
        const t = this.typeAtIndex(index);
        const attribtues = this.typeAttributes[index];
        return [t, attribtues];
    }

    public addAttributes(tref: TypeRef, attributes: TypeAttributes): void {
        this.assertTypeRefGraph(tref);
        const index = typeRefIndex(tref);
        const existingAttributes = this.typeAttributes[index];
        assert(
            iterableEvery(attributes, ([k, v]) => {
                if (!k.inIdentity) return true;
                const existing = existingAttributes.get(k);
                if (existing === undefined) return false;
                return areEqual(existing, v);
            }),
            "Can't add different identity type attributes to an existing type"
        );
        const maybeType = this.types[index];
        if (maybeType !== undefined) {
            attributes = this.filterTypeAttributes(maybeType, attributes);
        }

        const nonIdentityAttributes = mapFilter(attributes, (_, k) => !k.inIdentity);
        this.typeAttributes[index] = combineTypeAttributes("union", existingAttributes, nonIdentityAttributes);
    }

    public finish(): TypeGraph {
        this.typeGraph.freeze(this.topLevels, this.types.map(defined), this.typeAttributes);
        return this.typeGraph;
    }

    protected addForwardingIntersection(forwardingRef: TypeRef, tref: TypeRef): TypeRef {
        this.assertTypeRefGraph(tref);
        this._addedForwardingIntersection = true;
        return this.addType(forwardingRef, tr => new IntersectionType(tr, this.typeGraph, new Set([tref])), undefined);
    }

    protected forwardIfNecessary(forwardingRef: TypeRef | undefined, tref: undefined): undefined;
    protected forwardIfNecessary(forwardingRef: TypeRef | undefined, tref: TypeRef): TypeRef;
    protected forwardIfNecessary(forwardingRef: TypeRef | undefined, tref: TypeRef | undefined): TypeRef | undefined;
    protected forwardIfNecessary(forwardingRef: TypeRef | undefined, tref: TypeRef | undefined): TypeRef | undefined {
        if (tref === undefined) return undefined;
        if (forwardingRef === undefined) return tref;
        return this.addForwardingIntersection(forwardingRef, tref);
    }

    public get didAddForwardingIntersection(): boolean {
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
                this.addAttributes(
                    result,
                    mapFilter(attributes, (_, k) => !k.inIdentity)
                );
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

    public getPrimitiveType(
        kind: PrimitiveTypeKind,
        maybeAttributes?: TypeAttributes,
        forwardingRef?: TypeRef
    ): TypeRef {
        const attributes = withDefault(maybeAttributes, emptyTypeAttributes);
        // FIXME: Why do date/time types need a StringTypes attribute?
        // FIXME: Remove this from here and put it into flattenStrings
        let stringTypes = kind === "string" ? undefined : StringTypes.unrestricted;
        if (isPrimitiveStringTypeKind(kind) && kind !== "string") {
            kind = stringTypeMappingGet(this._stringTypeMapping, kind);
        }

        if (kind === "string") {
            return this.getStringType(attributes, stringTypes, forwardingRef);
        }

        return this.getOrAddType(
            () => primitiveTypeIdentity(kind, attributes),
            tr => new PrimitiveType(tr, this.typeGraph, kind),
            attributes,
            forwardingRef
        );
    }

    public getStringType(
        attributes: TypeAttributes,
        stringTypes: StringTypes | undefined,
        forwardingRef?: TypeRef
    ): TypeRef {
        const existingStringTypes = mapFind(attributes, (_, k) => k === stringTypesTypeAttributeKind);
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
            tr => new PrimitiveType(tr, this.typeGraph, "string"),
            attributes,
            forwardingRef
        );
    }

    public getEnumType(attributes: TypeAttributes, cases: ReadonlySet<string>, forwardingRef?: TypeRef): TypeRef {
        return this.getOrAddType(
            () => enumTypeIdentity(attributes, cases),
            tr => new EnumType(tr, this.typeGraph, cases),
            attributes,
            forwardingRef
        );
    }

    public makeClassProperty(tref: TypeRef, isOptional: boolean): ClassProperty {
        return new ClassProperty(tref, this.typeGraph, isOptional);
    }

    public getUniqueObjectType(
        attributes: TypeAttributes,
        properties: ReadonlyMap<string, ClassProperty> | undefined,
        additionalProperties: TypeRef | undefined,
        forwardingRef?: TypeRef
    ): TypeRef {
        this.assertTypeRefGraph(additionalProperties);

        properties = definedMap(properties, p => this.modifyPropertiesIfNecessary(p));
        return this.addType(
            forwardingRef,
            tref => new ObjectType(tref, this.typeGraph, "object", true, properties, additionalProperties),
            attributes
        );
    }

    public getUniqueMapType(forwardingRef?: TypeRef): TypeRef {
        return this.addType(forwardingRef, tr => new MapType(tr, this.typeGraph, undefined), undefined);
    }

    public getMapType(attributes: TypeAttributes, values: TypeRef, forwardingRef?: TypeRef): TypeRef {
        this.assertTypeRefGraph(values);

        return this.getOrAddType(
            () => mapTypeIdentify(attributes, values),
            tr => new MapType(tr, this.typeGraph, values),
            attributes,
            forwardingRef
        );
    }

    public setObjectProperties(
        ref: TypeRef,
        properties: ReadonlyMap<string, ClassProperty>,
        additionalProperties: TypeRef | undefined
    ): void {
        this.assertTypeRefGraph(additionalProperties);

        const type = derefTypeRef(ref, this.typeGraph);
        if (!(type instanceof ObjectType)) {
            return panic("Tried to set properties of non-object type");
        }

        type.setProperties(this.modifyPropertiesIfNecessary(properties), additionalProperties);
        this.registerType(type);
    }

    public getUniqueArrayType(forwardingRef?: TypeRef): TypeRef {
        return this.addType(forwardingRef, tr => new ArrayType(tr, this.typeGraph, undefined), undefined);
    }

    public getArrayType(attributes: TypeAttributes, items: TypeRef, forwardingRef?: TypeRef): TypeRef {
        this.assertTypeRefGraph(items);

        return this.getOrAddType(
            () => arrayTypeIdentity(attributes, items),
            tr => new ArrayType(tr, this.typeGraph, items),
            attributes,
            forwardingRef
        );
    }

    public setArrayItems(ref: TypeRef, items: TypeRef): void {
        this.assertTypeRefGraph(items);

        const type = derefTypeRef(ref, this.typeGraph);
        if (!(type instanceof ArrayType)) {
            return panic("Tried to set items of non-array type");
        }

        type.setItems(items);
        this.registerType(type);
    }

    public modifyPropertiesIfNecessary(
        properties: ReadonlyMap<string, ClassProperty>
    ): ReadonlyMap<string, ClassProperty> {
        properties.forEach(p => this.assertTypeRefGraph(p.typeRef));

        if (this.canonicalOrder) {
            properties = mapSortByKey(properties);
        }

        if (this._allPropertiesOptional) {
            properties = mapMap(properties, cp => this.makeClassProperty(cp.typeRef, true));
        }

        return properties;
    }

    public getClassType(
        attributes: TypeAttributes,
        properties: ReadonlyMap<string, ClassProperty>,
        forwardingRef?: TypeRef
    ): TypeRef {
        properties = this.modifyPropertiesIfNecessary(properties);
        return this.getOrAddType(
            () => classTypeIdentity(attributes, properties),
            tr => new ClassType(tr, this.typeGraph, false, properties),
            attributes,
            forwardingRef
        );
    }

    // FIXME: Maybe just distinguish between this and `getClassType`
    // via a flag?  That would make `ClassType.map` simpler.
    public getUniqueClassType(
        attributes: TypeAttributes,
        isFixed: boolean,
        properties: ReadonlyMap<string, ClassProperty> | undefined,
        forwardingRef?: TypeRef
    ): TypeRef {
        properties = definedMap(properties, p => this.modifyPropertiesIfNecessary(p));
        return this.addType(
            forwardingRef,
            tref => new ClassType(tref, this.typeGraph, isFixed, properties),
            attributes
        );
    }

    public getUnionType(attributes: TypeAttributes, members: ReadonlySet<TypeRef>, forwardingRef?: TypeRef): TypeRef {
        this.assertTypeRefSetGraph(members);

        return this.getOrAddType(
            () => unionTypeIdentity(attributes, members),
            tr => new UnionType(tr, this.typeGraph, members),
            attributes,
            forwardingRef
        );
    }

    // FIXME: why do we sometimes call this with defined members???
    public getUniqueUnionType(
        attributes: TypeAttributes,
        members: ReadonlySet<TypeRef> | undefined,
        forwardingRef?: TypeRef
    ): TypeRef {
        this.assertTypeRefSetGraph(members);

        return this.addType(forwardingRef, tref => new UnionType(tref, this.typeGraph, members), attributes);
    }

    public getIntersectionType(
        attributes: TypeAttributes,
        members: ReadonlySet<TypeRef>,
        forwardingRef?: TypeRef
    ): TypeRef {
        this.assertTypeRefSetGraph(members);

        return this.getOrAddType(
            () => intersectionTypeIdentity(attributes, members),
            tr => new IntersectionType(tr, this.typeGraph, members),
            attributes,
            forwardingRef
        );
    }

    // FIXME: why do we sometimes call this with defined members???
    public getUniqueIntersectionType(
        attributes: TypeAttributes,
        members: ReadonlySet<TypeRef> | undefined,
        forwardingRef?: TypeRef
    ): TypeRef {
        this.assertTypeRefSetGraph(members);

        return this.addType(forwardingRef, tref => new IntersectionType(tref, this.typeGraph, members), attributes);
    }

    public setSetOperationMembers(ref: TypeRef, members: ReadonlySet<TypeRef>): void {
        this.assertTypeRefSetGraph(members);

        const type = derefTypeRef(ref, this.typeGraph);
        if (!(type instanceof UnionType || type instanceof IntersectionType)) {
            return panic("Tried to set members of non-set-operation type");
        }

        type.setMembers(members);
        this.registerType(type);
    }

    public setLostTypeAttributes(): void {
        return;
    }
}
