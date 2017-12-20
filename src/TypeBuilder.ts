"use strict";

import { Map, OrderedMap, OrderedSet, List, Set } from "immutable";

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
    StringType
} from "./Type";
import { TypeGraph } from "./TypeGraph";
import { defined, assert, panic } from "./Support";
import { TypeNames } from "./TypeNames";

export type TypeRefCallback = (index: number) => void;

export class TypeRef {
    private _maybeIndexOrRef?: number | TypeRef;
    private _callbacks?: TypeRefCallback[];

    constructor(readonly graph: TypeGraph, index?: number, private _allocate?: () => TypeRef) {
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

    get index(): number {
        const maybeIndex = this.maybeIndex;
        if (maybeIndex === undefined) {
            const tref = this.follow();
            if (tref._allocate !== undefined) {
                const allocated = tref._allocate();
                tref._maybeIndexOrRef = allocated;
                tref._allocate = undefined;
                return allocated.index;
            }

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
            assert(
                this.maybeIndex === tref.maybeIndex,
                "Trying to resolve an allocated type reference with an incompatible one"
            );
        } else {
            assert(tref.follow() !== this, "Tried to create a TypeRef cycle");
        }
        this._maybeIndexOrRef = tref;
        this._allocate = undefined;
        if (this._callbacks !== undefined) {
            for (const cb of this._callbacks) {
                tref.callWhenResolved(cb);
            }
            this._callbacks = undefined;
        }
    };

    deref = (): [Type, TypeNames | undefined] => {
        return this.graph.atIndex(this.index);
    };

    equals = (other: any): boolean => {
        if (!(other instanceof TypeRef)) {
            return false;
        }
        assert(this.graph === other.graph, "Comparing type refs of different graphs");
        return this.follow() === other.follow();
    };

    hashCode = (): number => {
        return this.index | 0;
    };
}

export type StringTypeMapping = {
    date: PrimitiveStringTypeKind;
    time: PrimitiveStringTypeKind;
    dateTime: PrimitiveStringTypeKind;
};

export abstract class TypeBuilder {
    readonly typeGraph: TypeGraph = new TypeGraph(this);

    protected topLevels: Map<string, TypeRef> = Map();
    protected types: List<Type | undefined> = List();
    protected typeNames: List<TypeNames | undefined> = List();

    constructor(private readonly _stringTypeMapping: StringTypeMapping) {}

    addTopLevel = (name: string, tref: TypeRef): void => {
        // assert(t.typeGraph === this.typeGraph, "Adding top-level to wrong type graph");
        assert(!this.topLevels.has(name), "Trying to add top-level with existing name");
        assert(this.types.get(tref.index) !== undefined, "Trying to add a top-level type that doesn't exist (yet?)");
        this.topLevels = this.topLevels.set(name, tref);
    };

    protected reserveTypeRef = (): TypeRef => {
        const index = this.types.size;
        this.types = this.types.push(undefined);
        this.typeNames = this.typeNames.push(undefined);
        return new TypeRef(this.typeGraph, index, undefined);
    };

    private commitType = (tref: TypeRef, t: Type, names: TypeNames | undefined): void => {
        assert(this.types.get(tref.index) === undefined, "A type index was committed twice");
        this.types = this.types.set(tref.index, t);
        this.typeNames = this.typeNames.set(tref.index, names);
    };

    protected addType<T extends Type>(
        forwardingRef: TypeRef | undefined,
        creator: (tref: TypeRef) => T,
        names: TypeNames | undefined
    ): TypeRef {
        if (names !== undefined) {
            // We need to copy the names here because they're modified
            // in `gatherNames`, and the caller doesn't guarantee that
            // this one is unique for this type.
            names = names.copy();
        }
        const tref =
            forwardingRef !== undefined && forwardingRef.maybeIndex !== undefined
                ? forwardingRef
                : this.reserveTypeRef();
        if (names !== undefined) {
            this.addNames(tref, names);
        }
        const t = creator(tref);
        this.commitType(tref, t, names);
        if (forwardingRef !== undefined && tref !== forwardingRef) {
            forwardingRef.resolve(tref);
        }
        return tref;
    }

    atIndex = (index: number): [Type, TypeNames | undefined] => {
        const maybeType = this.types.get(index);
        if (maybeType === undefined) {
            return panic("Trying to deref an undefined type in a type builder");
        }
        const maybeNames = this.typeNames.get(index);
        return [maybeType, maybeNames];
    };

    addNames = (tref: TypeRef, names: TypeNames): void => {
        tref.callWhenResolved(index => {
            const tn = this.typeNames.get(index);
            if (tn === undefined) {
                this.typeNames = this.typeNames.set(index, names);
            } else {
                tn.add(names);
            }
        });
    };

    makeNullable = (tref: TypeRef, typeNames: TypeNames): TypeRef => {
        const t = defined(this.types.get(tref.index));
        if (t.kind === "null") {
            return tref;
        }
        const nullType = this.getPrimitiveType("null");
        if (!(t instanceof UnionType)) {
            return this.getUnionType(typeNames, OrderedSet([tref, nullType]));
        }
        const [maybeNull, nonNulls] = removeNullFromUnion(t);
        if (maybeNull) return tref;
        return this.getUnionType(typeNames, nonNulls.map(nn => nn.typeRef).add(nullType));
    };

    finish(): TypeGraph {
        this.typeGraph.freeze(this.topLevels, this.types.map(defined), this.typeNames);
        return this.typeGraph;
    }

    // FIXME: make mutable?
    private _primitiveTypes: Map<PrimitiveTypeKind, TypeRef> = Map();
    private _mapTypes: Map<TypeRef, TypeRef> = Map();
    private _arrayTypes: Map<TypeRef, TypeRef> = Map();
    private _enumTypes: Map<Set<string>, TypeRef> = Map();
    private _classTypes: Map<Map<string, TypeRef>, TypeRef> = Map();
    private _unionTypes: Map<Set<TypeRef>, TypeRef> = Map();

    getPrimitiveType(kind: PrimitiveTypeKind, forwardingRef?: TypeRef): TypeRef {
        if (kind === "date") kind = this._stringTypeMapping.date;
        if (kind === "time") kind = this._stringTypeMapping.time;
        if (kind === "date-time") kind = this._stringTypeMapping.dateTime;
        let tref = this._primitiveTypes.get(kind);
        if (tref === undefined) {
            tref = this.addType(
                forwardingRef,
                tr => (kind === "string" ? new StringType(tr) : new PrimitiveType(tr, kind)),
                undefined
            );
            this._primitiveTypes = this._primitiveTypes.set(kind, tref);
        }
        return tref;
    }

    getEnumType(names: TypeNames, cases: OrderedSet<string>, forwardingRef?: TypeRef): TypeRef {
        const unorderedCases = cases.toSet();
        let tref = this._enumTypes.get(unorderedCases);
        if (tref === undefined) {
            tref = this.addType(forwardingRef, tr => new EnumType(tr, cases), names);
            this._enumTypes = this._enumTypes.set(unorderedCases, tref);
        } else {
            this.addNames(tref, names);
        }
        return tref;
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

    getClassType(names: TypeNames, properties: OrderedMap<string, TypeRef>, forwardingRef?: TypeRef): TypeRef {
        let tref = this._classTypes.get(properties.toMap());
        if (forwardingRef !== undefined || tref === undefined) {
            tref = this.addType(forwardingRef, tr => new ClassType(tr, false, properties), names);
            this._classTypes = this._classTypes.set(properties.toMap(), tref);
        } else {
            this.addNames(tref, names);
        }
        return tref;
    }

    // FIXME: Maybe just distinguish between this and `getClassType`
    // via a flag?  That would make `ClassType.map` simpler.
    getUniqueClassType = (
        names: TypeNames,
        properties?: OrderedMap<string, TypeRef>,
        forwardingRef?: TypeRef
    ): TypeRef => {
        return this.addType(forwardingRef, tref => new ClassType(tref, true, properties), names);
    };

    getUnionType(names: TypeNames, members: OrderedSet<TypeRef>, forwardingRef?: TypeRef): TypeRef {
        const unorderedMembers = members.toSet();
        let tref = this._unionTypes.get(unorderedMembers);
        if (tref === undefined) {
            tref = this.addType(forwardingRef, tr => new UnionType(tr, members), names);
            this._unionTypes = this._unionTypes.set(unorderedMembers, tref);
        } else {
            this.addNames(tref, names);
        }
        return tref;
    }
}

export class TypeGraphBuilder extends TypeBuilder {
    protected typeForEntry(entry: Type | undefined): Type | undefined {
        return entry;
    }

    getLazyMapType(valuesCreator: () => TypeRef | undefined): TypeRef {
        return this.addType(undefined, tref => new MapType(tref, valuesCreator()), undefined);
    }

    getUniqueUnionType = (names: TypeNames, members: OrderedSet<TypeRef>): TypeRef => {
        return this.addType(undefined, tref => new UnionType(tref, members), names);
    };

    lookupType = (typeRef: TypeRef): Type | undefined => {
        const maybeIndex = typeRef.maybeIndex;
        if (maybeIndex === undefined) {
            return undefined;
        }
        return this.types.get(maybeIndex);
    };
}

export class TypeReconstituter {
    private _wasUsed: boolean = false;

    constructor(
        private readonly _typeBuilder: TypeBuilder,
        private readonly _typeNames: TypeNames | undefined,
        private readonly _forwardingRef: TypeRef
    ) {}

    private useBuilder = (): TypeBuilder => {
        assert(!this._wasUsed, "TypeReconstituter used more than once");
        this._wasUsed = true;
        return this._typeBuilder;
    };

    getPrimitiveType = (kind: PrimitiveTypeKind): TypeRef => {
        return this.useBuilder().getPrimitiveType(kind, this._forwardingRef);
    };

    getEnumType = (cases: OrderedSet<string>): TypeRef => {
        return this.useBuilder().getEnumType(defined(this._typeNames), cases, this._forwardingRef);
    };

    getMapType = (values: TypeRef): TypeRef => {
        return this.useBuilder().getMapType(values, this._forwardingRef);
    };

    getArrayType = (items: TypeRef): TypeRef => {
        return this.useBuilder().getArrayType(items, this._forwardingRef);
    };

    getClassType = (properties: OrderedMap<string, TypeRef>): TypeRef => {
        return this.useBuilder().getClassType(defined(this._typeNames), properties, this._forwardingRef);
    };

    getUniqueClassType = (properties?: OrderedMap<string, TypeRef>): TypeRef => {
        return this.useBuilder().getUniqueClassType(defined(this._typeNames), properties, this._forwardingRef);
    };

    getUnionType = (members: OrderedSet<TypeRef>): TypeRef => {
        return this.useBuilder().getUnionType(defined(this._typeNames), members, this._forwardingRef);
    };
}

export class GraphRewriteBuilder<T extends Type> extends TypeBuilder {
    private _setsToReplaceByMember: Map<number, Set<T>>;
    private _reconstitutedTypes: Map<number, TypeRef> = Map();

    constructor(
        private readonly _originalGraph: TypeGraph,
        stringTypeMapping: StringTypeMapping,
        setsToReplace: T[][],
        private readonly _replacer: (typesToReplace: Set<T>, builder: GraphRewriteBuilder<T>) => TypeRef
    ) {
        super(stringTypeMapping);
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
        const forwardingRef = new TypeRef(this.typeGraph, undefined, this.reserveTypeRef);
        const actualRef = typeCreator(forwardingRef);
        forwardingRef.resolve(actualRef);
        return actualRef;
    }

    private replaceSet(typesToReplace: Set<T>): TypeRef {
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
        const index = originalRef.index;
        const maybeTypeRef = this._reconstitutedTypes.get(index);
        if (maybeTypeRef !== undefined) {
            return maybeTypeRef;
        }
        const maybeSet = this._setsToReplaceByMember.get(index);
        if (maybeSet !== undefined) {
            return this.replaceSet(maybeSet);
        }
        return this.withForwardingRef(forwardingRef => {
            this._reconstitutedTypes = this._reconstitutedTypes.set(index, forwardingRef);
            const [originalType, originalNames] = originalRef.deref();
            return originalType.map(
                new TypeReconstituter(this, originalNames, forwardingRef),
                this.getReconstitutedType
            );
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
    private _stringTypes = OrderedSet<PrimitiveStringTypeKind>();
    private readonly _arrays: TArray[] = [];
    private readonly _maps: TMap[] = [];
    private readonly _classes: TClass[] = [];
    private _enumCaseMap: { [name: string]: number } = {};
    private _enumCases: string[] = [];

    constructor(protected readonly typeBuilder: TypeGraphBuilder, protected readonly typeNames: TypeNames) {}

    get haveString(): boolean {
        return this._stringTypes.has("string");
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

    addStringType = (kind: PrimitiveStringTypeKind): void => {
        if (this._stringTypes.has(kind)) return;
        // string overrides all other string types, as well as enum
        if (kind === "string") {
            this._stringTypes = OrderedSet([kind]);
            this._enumCaseMap = {};
            this._enumCases = [];
        } else {
            if (this.haveString) return;
            this._stringTypes = this._stringTypes.add(kind);
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
        if (this.haveString) {
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
        this._stringTypes.forEach(kind => {
            types.push(this.typeBuilder.getPrimitiveType(kind));
        });
        if (this._enumCases.length > 0) {
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
            this.typeBuilder.addNames(types[0], this.typeNames);
            return types[0];
        }
        const typesSet = OrderedSet(types);
        if (unique) {
            return this.typeBuilder.getUniqueUnionType(this.typeNames, typesSet);
        } else {
            return this.typeBuilder.getUnionType(this.typeNames, typesSet);
        }
    };
}
