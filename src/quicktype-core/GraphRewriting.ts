import { PrimitiveTypeKind, Type, ClassProperty, MaybeTypeIdentity } from "./Type";
import { combineTypeAttributesOfTypes } from "./TypeUtils";
import { TypeGraph, TypeRef, derefTypeRef, typeAndAttributesForTypeRef } from "./TypeGraph";
import { TypeAttributes, emptyTypeAttributes, combineTypeAttributes } from "./TypeAttributes";
import { assert, panic, indentationString } from "./support/Support";
import { TypeBuilder, StringTypeMapping } from "./TypeBuilder";
import { mapMap, EqualityMap } from "./support/Containers";

export interface TypeLookerUp {
    lookupTypeRefs(typeRefs: TypeRef[], forwardingRef?: TypeRef): TypeRef | undefined;
    reconstituteTypeRef(typeRef: TypeRef, attributes?: TypeAttributes, forwardingRef?: TypeRef): TypeRef;
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
    lookup(trefs: Iterable<TypeRef>): ReadonlyArray<TypeRef> | undefined;
    lookup(trefs: TypeRef | Iterable<TypeRef>): TypeRef | ReadonlyArray<TypeRef> | undefined {
        assert(!this._wasUsed, "Cannot lookup constituents after building type");
        if (trefs instanceof TypeRef) {
            return this._typeBuilder.lookupTypeRefs([trefs], undefined, false);
        } else {
            const maybeRefs = Array.from(trefs).map(tref => this._typeBuilder.lookupTypeRefs([tref], undefined, false));
            if (maybeRefs.some(tref => tref === undefined)) return undefined;
            return maybeRefs as ReadonlyArray<TypeRef>;
        }
    }

    lookupMap<K>(trefs: ReadonlyMap<K, TypeRef>): ReadonlyMap<K, TypeRef> | undefined {
        const resultValues = this.lookup(trefs.values());
        if (resultValues === undefined) return undefined;
        assert(resultValues.length === trefs.size, "Didn't get back the correct number of types");
        const result = new Map<K, TypeRef>();
        let i = 0;
        for (const k of trefs.keys()) {
            result.set(k, resultValues[i]);
            i += 1;
        }
        return result;
    }

    reconstitute(tref: TypeRef): TypeRef;
    reconstitute(trefs: Iterable<TypeRef>): ReadonlyArray<TypeRef>;
    reconstitute(trefs: TypeRef | Iterable<TypeRef>): TypeRef | ReadonlyArray<TypeRef> {
        assert(this._wasUsed, "Cannot reconstitute constituents before building type");
        if (trefs instanceof TypeRef) {
            return this._typeBuilder.reconstituteTypeRef(trefs);
        } else {
            return Array.from(trefs).map(tref => this._typeBuilder.reconstituteTypeRef(tref));
        }
    }

    reconstituteMap<K>(trefs: ReadonlyMap<K, TypeRef>): ReadonlyMap<K, TypeRef> {
        return mapMap(trefs, tref => this._typeBuilder.reconstituteTypeRef(tref));
    }

    getPrimitiveType(kind: PrimitiveTypeKind): void {
        this.register(this.builderForNewType().getPrimitiveType(kind, this._typeAttributes, this._forwardingRef));
    }

    getEnumType(cases: ReadonlySet<string>): void {
        this.register(this.builderForNewType().getEnumType(this._typeAttributes, cases, this._forwardingRef));
    }

    getUniqueMapType(): void {
        this.registerAndAddAttributes(this.builderForNewType().getUniqueMapType(this._forwardingRef));
    }

    getMapType(values: TypeRef): void {
        this.register(this.builderForNewType().getMapType(this._typeAttributes, values, this._forwardingRef));
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

    makeClassProperty(tref: TypeRef, isOptional: boolean): ClassProperty {
        return this._typeBuilder.makeClassProperty(tref, isOptional);
    }

    getObjectType(properties: ReadonlyMap<string, ClassProperty>, additionalProperties: TypeRef | undefined): void {
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
        properties: ReadonlyMap<string, ClassProperty> | undefined,
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

    getClassType(properties: ReadonlyMap<string, ClassProperty>): void {
        if (this._makeClassUnique) {
            this.getUniqueClassType(false, properties);
            return;
        }
        this.register(this.builderForNewType().getClassType(this._typeAttributes, properties, this._forwardingRef));
    }

    getUniqueClassType(isFixed: boolean, properties: ReadonlyMap<string, ClassProperty> | undefined): void {
        this.register(
            this.builderForNewType().getUniqueClassType(this._typeAttributes, isFixed, properties, this._forwardingRef)
        );
    }

    setObjectProperties(
        properties: ReadonlyMap<string, ClassProperty>,
        additionalProperties: TypeRef | undefined
    ): void {
        this.builderForSetting().setObjectProperties(this.getResult(), properties, additionalProperties);
    }

    getUnionType(members: ReadonlySet<TypeRef>): void {
        this.register(this.builderForNewType().getUnionType(this._typeAttributes, members, this._forwardingRef));
    }

    getUniqueUnionType(): void {
        this.register(
            this.builderForNewType().getUniqueUnionType(this._typeAttributes, undefined, this._forwardingRef)
        );
    }

    getIntersectionType(members: ReadonlySet<TypeRef>): void {
        this.register(this.builderForNewType().getIntersectionType(this._typeAttributes, members, this._forwardingRef));
    }

    getUniqueIntersectionType(members?: ReadonlySet<TypeRef>): void {
        this.register(
            this.builderForNewType().getUniqueIntersectionType(this._typeAttributes, members, this._forwardingRef)
        );
    }

    setSetOperationMembers(members: ReadonlySet<TypeRef>): void {
        this.builderForSetting().setSetOperationMembers(this.getResult(), members);
    }
}

export abstract class BaseGraphRewriteBuilder extends TypeBuilder implements TypeLookerUp {
    protected readonly reconstitutedTypes: Map<number, TypeRef> = new Map();

    private _lostTypeAttributes: boolean = false;
    private _printIndent = 0;

    constructor(
        readonly originalGraph: TypeGraph,
        stringTypeMapping: StringTypeMapping,
        alphabetizeProperties: boolean,
        graphHasProvenanceAttributes: boolean,
        protected readonly debugPrint: boolean
    ) {
        super(stringTypeMapping, alphabetizeProperties, false, false, graphHasProvenanceAttributes);
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

    reconstituteType(t: Type, attributes?: TypeAttributes, forwardingRef?: TypeRef): TypeRef {
        return this.reconstituteTypeRef(t.typeRef, attributes, forwardingRef);
    }

    abstract lookupTypeRefs(typeRefs: TypeRef[], forwardingRef?: TypeRef, replaceSet?: boolean): TypeRef | undefined;
    protected abstract forceReconstituteTypeRef(
        originalRef: TypeRef,
        attributes?: TypeAttributes,
        maybeForwardingRef?: TypeRef
    ): TypeRef;

    reconstituteTypeRef(originalRef: TypeRef, attributes?: TypeAttributes, maybeForwardingRef?: TypeRef): TypeRef {
        const maybeRef = this.lookupTypeRefs([originalRef], maybeForwardingRef);
        if (maybeRef !== undefined) {
            if (attributes !== undefined) {
                this.addAttributes(maybeRef, attributes);
            }
            return maybeRef;
        }
        return this.forceReconstituteTypeRef(originalRef, attributes, maybeForwardingRef);
    }

    reconstituteTypeAttributes(attributes: TypeAttributes): TypeAttributes {
        return mapMap(attributes, (v, a) => a.reconstitute(this, v));
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
        return indentationString(this._printIndent);
    }

    finish(): TypeGraph {
        for (const [name, t] of this.originalGraph.topLevels) {
            this.addTopLevel(name, this.reconstituteType(t));
        }
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
    private readonly _attributeSources: Map<Type, Type[]> = new Map();

    constructor(
        originalGraph: TypeGraph,
        stringTypeMapping: StringTypeMapping,
        alphabetizeProperties: boolean,
        graphHasProvenanceAttributes: boolean,
        private readonly _map: ReadonlyMap<Type, Type>,
        debugPrintRemapping: boolean
    ) {
        super(
            originalGraph,
            stringTypeMapping,
            alphabetizeProperties,
            graphHasProvenanceAttributes,
            debugPrintRemapping
        );

        for (const [source, target] of _map) {
            let maybeSources = this._attributeSources.get(target);
            if (maybeSources === undefined) {
                maybeSources = [target];
                this._attributeSources.set(target, maybeSources);
            }
            maybeSources.push(source);
        }
    }

    protected makeIdentity(_maker: () => MaybeTypeIdentity): MaybeTypeIdentity {
        return undefined;
    }

    private getMapTarget(tref: TypeRef): TypeRef {
        const maybeType = this._map.get(derefTypeRef(tref, this.originalGraph));
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

        const first = this.reconstitutedTypes.get(this.getMapTarget(typeRefs[0]).index);
        if (first === undefined) return undefined;

        for (let i = 1; i < typeRefs.length; i++) {
            const other = this.reconstitutedTypes.get(this.getMapTarget(typeRefs[i]).index);
            if (first !== other) return undefined;
        }

        return first;
    }

    protected forceReconstituteTypeRef(
        originalRef: TypeRef,
        attributes?: TypeAttributes,
        maybeForwardingRef?: TypeRef
    ): TypeRef {
        originalRef = this.getMapTarget(originalRef);

        const index = originalRef.index;
        assert(this.reconstitutedTypes.get(index) === undefined, "Type has already been reconstituted");

        assert(maybeForwardingRef === undefined, "We can't have a forwarding ref when we remap");

        const [originalType, originalAttributes] = typeAndAttributesForTypeRef(originalRef, this.originalGraph);

        const attributeSources = this._attributeSources.get(originalType);
        if (attributes === undefined) {
            attributes = emptyTypeAttributes;
        }
        if (attributeSources === undefined) {
            attributes = combineTypeAttributes(
                "union",
                attributes,
                this.reconstituteTypeAttributes(originalAttributes)
            );
        } else {
            attributes = combineTypeAttributes(
                "union",
                attributes,
                this.reconstituteTypeAttributes(combineTypeAttributesOfTypes("union", attributeSources))
            );
        }
        const newAttributes = attributes;

        return this.withForwardingRef(undefined, forwardingRef => {
            this.reconstitutedTypes.set(index, forwardingRef);

            if (this.debugPrint) {
                console.log(`${this.debugPrintIndentation}reconstituting ${index} as ${forwardingRef.index}`);
                this.changeDebugPrintIndent(1);
            }

            const reconstituter = new TypeReconstituter(
                this,
                this.canonicalOrder,
                newAttributes,
                forwardingRef,
                tref => {
                    assert(tref === forwardingRef, "Reconstituted type as a different ref");
                    if (this.debugPrint) {
                        this.changeDebugPrintIndent(-1);
                        console.log(`${this.debugPrintIndentation}reconstituted ${index} as ${tref.index}`);
                    }
                }
            );
            originalType.reconstitute(reconstituter, this.canonicalOrder);
            return reconstituter.getResult();
        });
    }
}

export class GraphRewriteBuilder<T extends Type> extends BaseGraphRewriteBuilder {
    private readonly _setsToReplaceByMember: Map<number, Set<T>>;
    private readonly _reconstitutedUnions: EqualityMap<Set<TypeRef>, TypeRef> = new EqualityMap();

    constructor(
        originalGraph: TypeGraph,
        stringTypeMapping: StringTypeMapping,
        alphabetizeProperties: boolean,
        graphHasProvenanceAttributes: boolean,
        setsToReplace: T[][],
        debugPrintReconstitution: boolean,
        private readonly _replacer: (
            typesToReplace: ReadonlySet<T>,
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

        this._setsToReplaceByMember = new Map();
        for (const types of setsToReplace) {
            const set = new Set(types);
            for (const t of set) {
                const index = t.typeRef.index;
                assert(!this._setsToReplaceByMember.has(index), "A type is member of more than one set to be replaced");
                this._setsToReplaceByMember.set(index, set);
            }
        }
    }

    registerUnion(typeRefs: TypeRef[], reconstituted: TypeRef): void {
        const set = new Set(typeRefs);
        assert(!this._reconstitutedUnions.has(set), "Cannot register reconstituted set twice");
        this._reconstitutedUnions.set(set, reconstituted);
    }

    private replaceSet(typesToReplace: ReadonlySet<T>, maybeForwardingRef: TypeRef | undefined): TypeRef {
        return this.withForwardingRef(maybeForwardingRef, forwardingRef => {
            if (this.debugPrint) {
                console.log(
                    `${this.debugPrintIndentation}replacing set ${Array.from(typesToReplace)
                        .map(t => t.typeRef.index.toString())
                        .join(",")} as ${forwardingRef.index}`
                );
                this.changeDebugPrintIndent(1);
            }

            for (const t of typesToReplace) {
                const originalRef = t.typeRef;
                const index = originalRef.index;
                this.reconstitutedTypes.set(index, forwardingRef);
                this._setsToReplaceByMember.delete(index);
            }
            const result = this._replacer(typesToReplace, this, forwardingRef);
            assert(result === forwardingRef, "The forwarding ref got lost when replacing");

            if (this.debugPrint) {
                this.changeDebugPrintIndent(-1);
                console.log(
                    `${this.debugPrintIndentation}replaced set ${Array.from(typesToReplace)
                        .map(t => t.typeRef.index.toString())
                        .join(",")} as ${forwardingRef.index}`
                );
            }

            return result;
        });
    }

    protected forceReconstituteTypeRef(
        originalRef: TypeRef,
        attributes?: TypeAttributes,
        maybeForwardingRef?: TypeRef
    ): TypeRef {
        const [originalType, originalAttributes] = typeAndAttributesForTypeRef(originalRef, this.originalGraph);
        const index = originalRef.index;

        if (this.debugPrint) {
            console.log(`${this.debugPrintIndentation}reconstituting ${index}`);
            this.changeDebugPrintIndent(1);
        }

        if (attributes === undefined) {
            attributes = this.reconstituteTypeAttributes(originalAttributes);
        } else {
            attributes = combineTypeAttributes(
                "union",
                attributes,
                this.reconstituteTypeAttributes(originalAttributes)
            );
        }

        const reconstituter = new TypeReconstituter(this, this.canonicalOrder, attributes, maybeForwardingRef, tref => {
            if (this.debugPrint) {
                this.changeDebugPrintIndent(-1);
                console.log(`${this.debugPrintIndentation}reconstituted ${index} as ${tref.index}`);
            }

            if (maybeForwardingRef !== undefined) {
                assert(tref === maybeForwardingRef, "We didn't pass the forwarding ref");
            }

            const alreadyReconstitutedType = this.reconstitutedTypes.get(index);
            if (alreadyReconstitutedType === undefined) {
                this.reconstitutedTypes.set(index, tref);
            } else {
                assert(tref === alreadyReconstitutedType, "We reconstituted a type twice differently");
            }
        });
        originalType.reconstitute(reconstituter, this.canonicalOrder);
        return reconstituter.getResult();
    }

    /*
    reconstituteTypeUnmodified(originalType: Type): TypeRef {
        const reconstituter = new TypeReconstituter(
            this,
            this.alphabetizeProperties,
            emptyTypeAttributes,
            undefined,
            () => {}
        );
        originalType.reconstitute(reconstituter);
        return reconstituter.getResult();
    }
    */

    // If the union of these type refs have been, or are supposed to be, reconstituted to
    // one target type, return it.  Otherwise return undefined.
    lookupTypeRefs(typeRefs: TypeRef[], forwardingRef?: TypeRef, replaceSet: boolean = true): TypeRef | undefined {
        this.assertTypeRefsToReconstitute(typeRefs, forwardingRef);

        // Check whether we have already reconstituted them.  That means ensuring
        // that they all have the same target type.
        let maybeRef = this.reconstitutedTypes.get(typeRefs[0].index);
        if (maybeRef !== undefined && maybeRef !== forwardingRef) {
            let allEqual = true;
            for (let i = 1; i < typeRefs.length; i++) {
                if (this.reconstitutedTypes.get(typeRefs[i].index) !== maybeRef) {
                    allEqual = false;
                    break;
                }
            }
            if (allEqual) {
                return this.forwardIfNecessary(forwardingRef, maybeRef);
            }
        }

        // Has this been reconstituted as a set?
        maybeRef = this._reconstitutedUnions.get(new Set(typeRefs));
        if (maybeRef !== undefined && maybeRef !== forwardingRef) {
            return this.forwardIfNecessary(forwardingRef, maybeRef);
        }

        // Is this set requested to be replaced?  If not, we're out of options.
        const maybeSet = this._setsToReplaceByMember.get(typeRefs[0].index);
        if (maybeSet === undefined) {
            return undefined;
        }
        for (let i = 1; i < typeRefs.length; i++) {
            if (this._setsToReplaceByMember.get(typeRefs[i].index) !== maybeSet) {
                return undefined;
            }
        }
        // Yes, this set is requested to be replaced, so do it.
        if (!replaceSet) return undefined;
        return this.replaceSet(maybeSet, forwardingRef);
    }
}
