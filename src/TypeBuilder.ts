"use strict";

import { Map, OrderedSet, List, Collection, Set } from "immutable";

import {
    PrimitiveTypeKind,
    Type,
    PrimitiveType,
    NamedType,
    EnumType,
    MapType,
    ArrayType,
    ClassType,
    UnionType,
    NameOrNames,
    removeNullFromUnion
} from "./Type";
import { TypeGraph } from "./TypeGraph";
import { defined, assert, panic } from "./Support";

export type TypeRefCallback = (index: number) => void;

export class TypeRef {
    private _maybeIndexOrRef?: number | TypeRef;
    private _callbacks?: TypeRefCallback[];

    constructor(readonly builder: CoalescingTypeBuilder, index?: number) {
        this._maybeIndexOrRef = index;
    }

    private follow(): TypeRef {
        if (this._maybeIndexOrRef instanceof TypeRef) {
            return this._maybeIndexOrRef.follow();
        }
        return this;
    }

    get graph(): TypeGraph {
        return this.builder.typeGraph;
    }

    get maybeIndex(): number | undefined {
        const tref = this.follow();
        if (typeof tref._maybeIndexOrRef === "number") {
            return tref._maybeIndexOrRef;
        }
        return undefined;
    }

    get index(): number {
        const maybeIndex = this.maybeIndex;
        if (maybeIndex === undefined) {
            return panic("Trying to dereference unresolved type reference");
        }
        return maybeIndex;
    }

    callWhenResolved = (callback: TypeRefCallback): void => {
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
    };

    resolve = (tref: TypeRef): void => {
        if (this._maybeIndexOrRef !== undefined) {
            return panic("Trying to resolve an already resolved type reference");
        }
        this._maybeIndexOrRef = tref;
        if (this._callbacks !== undefined) {
            for (const cb of this._callbacks) {
                tref.callWhenResolved(cb);
            }
            this._callbacks = undefined;
        }
    };

    deref = (): Type => {
        return defined(this.builder.types.get(this.index));
    };

    equals = (other: any): boolean => {
        if (!(other instanceof TypeRef)) {
            return false;
        }
        assert(this.builder === other.builder, "Comparing type refs of different graphs");
        return this.follow() === other.follow();
    };

    hashCode = (): number => {
        return this.index | 0;
    };
}

export interface TypeBuilder {
    getPrimitiveType(kind: PrimitiveTypeKind): TypeRef;
    getEnumType(names: NameOrNames, isInferred: boolean, cases: OrderedSet<string>): TypeRef;
    getMapType(values: TypeRef): TypeRef;
    getArrayType(items: TypeRef): TypeRef;
    getClassType(names: NameOrNames, isInferred: boolean, properties: Map<string, TypeRef>): TypeRef;
    getUnionType(names: NameOrNames, isInferred: boolean, members: OrderedSet<TypeRef>): TypeRef;
}

export abstract class CoalescingTypeBuilder implements TypeBuilder {
    readonly typeGraph: TypeGraph = new TypeGraph();

    protected topLevels: Map<string, TypeRef> = Map();
    types: List<Type | undefined> = List();

    protected namesToAdd: Map<number, { names: NameOrNames; isInferred: boolean }[]> = Map();

    addTopLevel = (name: string, tref: TypeRef): void => {
        // assert(t.typeGraph === this.typeGraph, "Adding top-level to wrong type graph");
        assert(!this.topLevels.has(name), "Trying to add top-level with existing name");
        assert(this.types.get(tref.index) !== undefined, "Trying to add a top-level type that doesn't exist (yet?)");
        this.topLevels = this.topLevels.set(name, tref);
    };

    reserveTypeRef = (): TypeRef => {
        const index = this.types.size;
        this.types = this.types.push(undefined);
        return new TypeRef(this, index);
    };

    commitType = (tref: TypeRef, t: Type): void => {
        assert(this.types.get(tref.index) === undefined, "A type index was committed twice");
        this.types = this.types.set(tref.index, t);
    };

    followIndex(index: number): number {
        return index;
    }

    protected addType<T extends Type>(creator: (tref: TypeRef) => T): TypeRef {
        const tref = this.reserveTypeRef();
        const t = creator(tref);
        this.commitType(tref, t);
        const namesToAdd = this.namesToAdd.get(tref.index);
        if (namesToAdd !== undefined) {
            if (t.isNamedType()) {
                for (const nta of namesToAdd) {
                    t.addNames(nta.names, nta.isInferred);
                }
            }
            this.namesToAdd = this.namesToAdd.remove(tref.index);
        }
        return tref;
    }

    addNames = (tref: TypeRef, names: NameOrNames, isInferred: boolean): void => {
        tref.callWhenResolved(index => {
            const t = this.types.get(index);
            if (t !== undefined) {
                if (!t.isNamedType()) {
                    return;
                }
                t.addNames(names, isInferred);
            } else {
                let entries = this.namesToAdd.get(index);
                if (entries === undefined) {
                    entries = [];
                    this.namesToAdd = this.namesToAdd.set(index, entries);
                }
                entries.push({ names, isInferred });
            }
        });
    };

    makeNullable = (tref: TypeRef, typeNames: NameOrNames, areNamesInferred: boolean): TypeRef => {
        const t = defined(this.types.get(tref.index));
        if (t.kind === "null") {
            return tref;
        }
        const nullType = this.getPrimitiveType("null");
        if (!(t instanceof UnionType)) {
            return this.getUnionType(typeNames, areNamesInferred, OrderedSet([tref, nullType]));
        }
        const [maybeNull, nonNulls] = removeNullFromUnion(t);
        if (maybeNull) return tref;
        return this.getUnionType(typeNames, areNamesInferred, nonNulls.map(nn => nn.typeRef).add(nullType));
    };

    finish(): TypeGraph {
        assert(this.namesToAdd.isEmpty(), "We're finishing, but still names to add left");
        this.typeGraph.freeze(this.topLevels, this.types.map(defined));
        return this.typeGraph;
    }

    // FIXME: make mutable?
    private _primitiveTypes: Map<PrimitiveTypeKind, TypeRef> = Map();
    private _mapTypes: Map<TypeRef, TypeRef> = Map();
    private _arrayTypes: Map<TypeRef, TypeRef> = Map();
    private _enumTypes: Map<Set<string>, TypeRef> = Map();
    private _classTypes: Map<Map<string, TypeRef>, TypeRef> = Map();
    private _unionTypes: Map<Set<TypeRef>, TypeRef> = Map();

    getPrimitiveType(kind: PrimitiveTypeKind): TypeRef {
        let tref = this._primitiveTypes.get(kind);
        if (tref === undefined) {
            tref = this.addType(tr => new PrimitiveType(tr, kind));
            this._primitiveTypes = this._primitiveTypes.set(kind, tref);
        }
        return tref;
    }

    getEnumType(names: NameOrNames, isInferred: boolean, cases: OrderedSet<string>): TypeRef {
        const unorderedCases = cases.toSet();
        let tref = this._enumTypes.get(unorderedCases);
        if (tref === undefined) {
            tref = this.addType(tr => new EnumType(tr, names, isInferred, cases));
            this._enumTypes = this._enumTypes.set(unorderedCases, tref);
        } else {
            this.addNames(tref, names, isInferred);
        }
        return tref;
    }

    getMapType(values: TypeRef): TypeRef {
        let tref = this._mapTypes.get(values);
        if (tref === undefined) {
            tref = this.addType(tr => new MapType(tr, values));
            this._mapTypes = this._mapTypes.set(values, tref);
        }
        return tref;
    }

    getArrayType(items: TypeRef): TypeRef {
        let tref = this._arrayTypes.get(items);
        if (tref === undefined) {
            tref = this.addType(tr => new ArrayType(tr, items));
            this._arrayTypes = this._arrayTypes.set(items, tref);
        }
        return tref;
    }

    getClassType(names: NameOrNames, isInferred: boolean, properties: Map<string, TypeRef>): TypeRef {
        let tref = this._classTypes.get(properties);
        if (tref === undefined) {
            tref = this.addType(tr => new ClassType(tr, names, isInferred, properties));
            this._classTypes = this._classTypes.set(properties, tref);
        } else {
            this.addNames(tref, names, isInferred);
        }
        return tref;
    }

    getUnionType(names: NameOrNames, isInferred: boolean, members: OrderedSet<TypeRef>): TypeRef {
        const unorderedMembers = members.toSet();
        let tref = this._unionTypes.get(unorderedMembers);
        if (tref === undefined) {
            tref = this.addType(tr => new UnionType(tr, names, isInferred, members));
            this._unionTypes = this._unionTypes.set(unorderedMembers, tref);
        } else {
            this.addNames(tref, names, isInferred);
        }
        return tref;
    }
}

export class TypeGraphBuilder extends CoalescingTypeBuilder {
    protected typeForEntry(entry: Type | undefined): Type | undefined {
        return entry;
    }

    getLazyMapType(valuesCreator: () => TypeRef | undefined): TypeRef {
        return this.addType(tref => new MapType(tref, valuesCreator()));
    }

    getUniqueClassType = (names: NameOrNames, isInferred: boolean, properties?: Map<string, TypeRef>): TypeRef => {
        return this.addType(tref => new ClassType(tref, names, isInferred, properties));
    };

    getUniqueUnionType = (name: string, isInferred: boolean, members: OrderedSet<TypeRef>): TypeRef => {
        return this.addType(tref => new UnionType(tref, name, isInferred, members));
    };

    lookupType = (typeRef: TypeRef): Type | undefined => {
        const maybeIndex = typeRef.maybeIndex;
        if (maybeIndex === undefined) {
            return undefined;
        }
        return this.types.get(maybeIndex);
    };
}

export class GraphRewriteBuilder extends CoalescingTypeBuilder {
    private _setsToReplaceByMember: Map<number, Set<Type>>;
    private _reconstitutedTypes: Map<number, TypeRef> = Map();

    constructor(
        private readonly _originalGraph: TypeGraph,
        setsToReplace: Type[][],
        private readonly _replacer: (typesToReplace: Set<Type>, builder: GraphRewriteBuilder) => TypeRef
    ) {
        super();
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

    followIndex(index: number): number {
        const entry = this.types.get(index);
        if (typeof entry === "number") {
            return this.followIndex(entry);
        }
        return index;
    }

    protected typeForEntry(entry: Type | undefined | number): Type | undefined {
        if (typeof entry === "number") {
            entry = this.types.get(this.followIndex(entry));
            if (typeof entry === "number") {
                return panic("followIndex led us to a forwarding entry");
            }
        }
        return entry;
    }

    private withForwardingRef(typeCreator: (forwardingRef: TypeRef) => TypeRef): TypeRef {
        const forwardingRef = new TypeRef(this);
        const actualRef = typeCreator(forwardingRef);
        forwardingRef.resolve(actualRef);
        return actualRef;
    }

    private replaceSet(typesToReplace: Set<Type>): TypeRef {
        return this.withForwardingRef(forwardingRef => {
            typesToReplace.forEach(t => {
                const originalRef = t.typeRef;
                this._reconstitutedTypes = this._reconstitutedTypes.set(originalRef.index, forwardingRef);
                this._setsToReplaceByMember = this._setsToReplaceByMember.remove(originalRef.index);
            });
            return this._replacer(typesToReplace, this);
        });
    }

    private getReconstitutedType = (originalRef: TypeRef): TypeRef => {
        const maybeTypeRef = this._reconstitutedTypes.get(originalRef.index);
        if (maybeTypeRef !== undefined) {
            return maybeTypeRef;
        }
        const maybeSet = this._setsToReplaceByMember.get(originalRef.index);
        if (maybeSet !== undefined) {
            return this.replaceSet(maybeSet);
        }
        return this.withForwardingRef(forwardingRef => {
            this._reconstitutedTypes = this._reconstitutedTypes.set(originalRef.index, forwardingRef);
            return originalRef.deref().map(this, this.getReconstitutedType);
        });
    };

    reconstituteType = (t: Type): TypeRef => {
        assert(t.typeRef.graph === this._originalGraph, "Trying to reconstitute a type from the wrong graph");
        return this.getReconstitutedType(t.typeRef);
    };

    finish(): TypeGraph {
        this._originalGraph.topLevels.forEach((t, name) => {
            this.addTopLevel(name, this.getReconstitutedType(t.typeRef));
        });
        return super.finish();
    }
}

export abstract class UnionBuilder<TArray, TClass, TMap> {
    private _haveAny = false;
    private _haveNull = false;
    private _haveBool = false;
    private _haveInteger = false;
    private _haveDouble = false;
    private _haveString = false;
    private readonly _arrays: TArray[] = [];
    private readonly _maps: TMap[] = [];
    private readonly _classes: TClass[] = [];
    private _enumCaseMap: { [name: string]: number } = {};
    private _enumCases: string[] = [];

    constructor(
        protected readonly typeBuilder: TypeGraphBuilder,
        protected readonly typeName: string,
        protected readonly isInferred: boolean
    ) {}

    get haveString(): boolean {
        return this._haveString;
    }

    addAny = (): void => {
        this._haveAny = true;
    };
    addNull = (): void => {
        this._haveNull = true;
    };
    addBool = (): void => {
        this._haveBool = true;
    };
    addInteger = (): void => {
        this._haveInteger = true;
    };
    addDouble = (): void => {
        this._haveDouble = true;
    };

    addString = (): void => {
        if (!this._haveString) {
            this._haveString = true;
            this._enumCaseMap = {};
            this._enumCases = [];
        }
    };
    addArray = (t: TArray): void => {
        this._arrays.push(t);
    };
    addClass = (t: TClass): void => {
        this._classes.push(t);
    };
    addMap = (t: TMap): void => {
        this._maps.push(t);
    };

    addEnumCase = (s: string): void => {
        if (this._haveString) {
            return;
        }
        if (!Object.prototype.hasOwnProperty.call(this._enumCaseMap, s)) {
            this._enumCaseMap[s] = 0;
            this._enumCases.push(s);
        }
        this._enumCaseMap[s] += 1;
    };

    protected abstract makeEnum(cases: string[]): TypeRef | null;
    protected abstract makeClass(classes: TClass[], maps: TMap[]): TypeRef;
    protected abstract makeArray(arrays: TArray[]): TypeRef;

    buildUnion = (unique: boolean): TypeRef => {
        const types: TypeRef[] = [];

        if (this._haveAny) {
            return this.typeBuilder.getPrimitiveType("any");
        }
        if (this._haveNull) {
            types.push(this.typeBuilder.getPrimitiveType("null"));
        }
        if (this._haveBool) {
            types.push(this.typeBuilder.getPrimitiveType("bool"));
        }
        if (this._haveDouble) {
            types.push(this.typeBuilder.getPrimitiveType("double"));
        } else if (this._haveInteger) {
            types.push(this.typeBuilder.getPrimitiveType("integer"));
        }
        if (this._haveString) {
            types.push(this.typeBuilder.getPrimitiveType("string"));
        } else if (this._enumCases.length > 0) {
            const maybeEnum = this.makeEnum(this._enumCases);
            if (maybeEnum !== null) {
                types.push(maybeEnum);
            } else {
                types.push(this.typeBuilder.getPrimitiveType("string"));
            }
        }
        if (this._classes.length > 0 || this._maps.length > 0) {
            types.push(this.makeClass(this._classes, this._maps));
        }
        if (this._arrays.length > 0) {
            types.push(this.makeArray(this._arrays));
        }

        if (types.length === 0) {
            return this.typeBuilder.getPrimitiveType("any");
        }
        if (types.length === 1) {
            this.typeBuilder.addNames(types[0], this.typeName, this.isInferred);
            return types[0];
        }
        const typesSet = OrderedSet(types);
        if (unique) {
            return this.typeBuilder.getUniqueUnionType(this.typeName, this.isInferred, typesSet);
        } else {
            return this.typeBuilder.getUnionType(this.typeName, this.isInferred, typesSet);
        }
    };
}
