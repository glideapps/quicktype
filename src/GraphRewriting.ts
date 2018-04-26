"use strict";

import { Map, OrderedMap, OrderedSet, Set, Collection, isCollection } from "immutable";

import { PrimitiveTypeKind, Type, ClassProperty } from "./Type";
import { combineTypeAttributesOfTypes } from "./TypeUtils";
import { TypeGraph } from "./TypeGraph";
import { TypeAttributes, emptyTypeAttributes, combineTypeAttributes } from "./TypeAttributes";
import { assert, panic } from "./Support";
import { TypeRef, TypeBuilder, StringTypeMapping } from "./TypeBuilder";

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
        this.register(this.builderForNewType().getPrimitiveType(kind, this._typeAttributes, this._forwardingRef));
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
        return this.reconstituteTypeRef(t.typeRef, undefined, forwardingRef);
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
        assert(maybeForwardingRef === undefined, "We can't have a forwarding ref when we remap");

        originalRef = this.getMapTarget(originalRef);
        const [originalType, originalAttributes] = originalRef.deref();

        const attributeSources = this._attributeSources.get(originalType);
        if (attributes === undefined) {
            attributes = emptyTypeAttributes;
        }
        if (attributeSources === undefined) {
            attributes = combineTypeAttributes(attributes, originalAttributes);
        } else {
            attributes = combineTypeAttributes(attributes, combineTypeAttributesOfTypes(attributeSources));
        }

        const index = originalRef.index;

        if (this.debugPrint) {
            console.log(`${this.debugPrintIndentation}reconstituting ${index}`);
            this.changeDebugPrintIndent(1);
        }

        const reconstituter = new TypeReconstituter(this, this.alphabetizeProperties, attributes, undefined, tref => {
            if (this.debugPrint) {
                this.changeDebugPrintIndent(-1);
                console.log(`${this.debugPrintIndentation}reconstituted ${index} as ${tref.index}`);
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
                const index = t.typeRef.index;
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
                        .map(t => t.typeRef.index.toString())
                        .join(",")} as ${forwardingRef.index}`
                );
                this.changeDebugPrintIndent(1);
            }

            typesToReplace.forEach(t => {
                const originalRef = t.typeRef;
                const index = originalRef.index;
                this.reconstitutedTypes = this.reconstitutedTypes.set(index, forwardingRef);
                this._setsToReplaceByMember = this._setsToReplaceByMember.remove(index);
            });
            const result = this._replacer(typesToReplace, this, forwardingRef);
            assert(result === forwardingRef, "The forwarding ref got lost when replacing");

            if (this.debugPrint) {
                this.changeDebugPrintIndent(-1);
                console.log(
                    `${this.debugPrintIndentation}replaced set ${typesToReplace
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
        const [originalType, originalAttributes] = originalRef.deref();
        const index = originalRef.index;

        if (this.debugPrint) {
            console.log(`${this.debugPrintIndentation}reconstituting ${index}`);
            this.changeDebugPrintIndent(1);
        }

        if (attributes === undefined) {
            attributes = originalAttributes;
        } else {
            attributes = combineTypeAttributes(attributes, originalAttributes);
        }

        const reconstituter = new TypeReconstituter(
            this,
            this.alphabetizeProperties,
            attributes,
            maybeForwardingRef,
            tref => {
                if (this.debugPrint) {
                    this.changeDebugPrintIndent(-1);
                    console.log(`${this.debugPrintIndentation}reconstituted ${index} as ${tref.index}`);
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
        maybeRef = this._reconstitutedUnions.get(Set(typeRefs));
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
