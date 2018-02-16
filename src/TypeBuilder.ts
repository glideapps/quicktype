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
    TypeKind
} from "./Type";
import { TypeGraph } from "./TypeGraph";
import { TypeAttributes, combineTypeAttributes } from "./TypeAttributes";
import { defined, assert, panic, assertNever } from "./Support";

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

export abstract class TypeBuilder {
    readonly typeGraph: TypeGraph = new TypeGraph(this);

    protected topLevels: Map<string, TypeRef> = Map();
    protected readonly types: (Type | undefined)[] = [];
    private readonly typeAttributes: TypeAttributes[] = [];

    constructor(
        private readonly _stringTypeMapping: StringTypeMapping,
        readonly alphabetizeProperties: boolean,
        private readonly _allPropertiesOptional: boolean
    ) { }

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
        this.typeAttributes.push(Map());
        return new TypeRef(this.typeGraph, index, undefined);
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
            this.typeAttributes[index] = combineTypeAttributes([this.typeAttributes[index], attributes]);
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
        properties?: OrderedMap<string, ClassProperty>,
        forwardingRef?: TypeRef
    ): TypeRef {
        if (properties !== undefined) {
            properties = this.modifyPropertiesIfNecessary(properties);
        }
        return this.addType(forwardingRef, tref => new ClassType(tref, isFixed, properties), attributes);
    }

    setClassProperties(ref: TypeRef, properties: OrderedMap<string, ClassProperty>): void {
        const type = ref.deref()[0];
        if (!(type instanceof ClassType)) {
            return panic("Tried to set properties of non-class type");
        }
        properties = this.modifyPropertiesIfNecessary(properties);
        type.setProperties(properties);
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

    getUniqueUnionType(attributes: TypeAttributes, members?: OrderedSet<TypeRef>): TypeRef {
        return this.addType(undefined, tref => new UnionType(tref, members), attributes);
    }

    setUnionMembers(ref: TypeRef, members: OrderedSet<TypeRef>): void {
        const type = ref.deref()[0];
        if (!(type instanceof UnionType)) {
            return panic("Tried to set members of non-union type");
        }
        type.setMembers(members);
    }
}

export interface TypeLookerUp {
    lookupTypeRefs(typeRefs: TypeRef[]): TypeRef | undefined;
    lookupTypeRef(typeRef: TypeRef): TypeRef;
    lookupType(typeRef: TypeRef): Type | undefined;
}

// Here's a case we can't handle: If the schema specifies
// types
//
//   Foo = class { x: Bar }
//   Bar = Foo | Quux
//   Quux = class { ... }
//
// then to resolve the properties of `Foo` we have to know
// the properties of `Bar`, but to resolve those we have to
// know the properties of `Foo`.
export function getHopefullyFinishedType(builder: TypeLookerUp, t: TypeRef): Type {
    const result = builder.lookupType(t);
    if (result === undefined) {
        return panic("Inconveniently recursive types");
    }
    return result;
}

export class TypeGraphBuilder extends TypeBuilder implements TypeLookerUp {
    protected typeForEntry(entry: Type | undefined): Type | undefined {
        return entry;
    }

    getLazyMapType(valuesCreator: () => TypeRef | undefined): TypeRef {
        return this.addType(undefined, tref => new MapType(tref, valuesCreator()), undefined);
    }

    lookupTypeRefs(_typeRefs: TypeRef[]): undefined {
        return undefined;
    }

    lookupTypeRef = (typeRef: TypeRef): TypeRef => {
        return typeRef;
    };

    lookupType = (typeRef: TypeRef): Type | undefined => {
        const maybeIndex = typeRef.maybeIndex;
        if (maybeIndex === undefined) {
            return undefined;
        }
        return this.types[maybeIndex];
    };
}

export class TypeReconstituter {
    private _wasUsed: boolean = false;

    constructor(
        private readonly _typeBuilder: TypeBuilder,
        private readonly _makeClassUnique: boolean,
        private readonly _typeAttributes: TypeAttributes,
        private readonly _forwardingRef: TypeRef
    ) { }

    private useBuilder = (): TypeBuilder => {
        assert(!this._wasUsed, "TypeReconstituter used more than once");
        this._wasUsed = true;
        return this._typeBuilder;
    };

    getPrimitiveType = (kind: PrimitiveTypeKind): TypeRef => {
        return this.useBuilder().getPrimitiveType(kind, this._forwardingRef);
    };

    getStringType = (enumCases: OrderedMap<string, number> | undefined): TypeRef => {
        return this.useBuilder().getStringType(this._typeAttributes, enumCases, this._forwardingRef);
    };

    getEnumType = (cases: OrderedSet<string>): TypeRef => {
        return this.useBuilder().getEnumType(defined(this._typeAttributes), cases, this._forwardingRef);
    };

    getMapType = (values: TypeRef): TypeRef => {
        return this.useBuilder().getMapType(values, this._forwardingRef);
    };

    getArrayType = (items: TypeRef): TypeRef => {
        return this.useBuilder().getArrayType(items, this._forwardingRef);
    };

    getClassType = (properties: OrderedMap<string, ClassProperty>): TypeRef => {
        if (this._makeClassUnique) {
            return this.getUniqueClassType(false, properties);
        }
        return this.useBuilder().getClassType(defined(this._typeAttributes), properties, this._forwardingRef);
    };

    getUniqueClassType = (isFixed: boolean, properties?: OrderedMap<string, ClassProperty>): TypeRef => {
        return this.useBuilder().getUniqueClassType(
            defined(this._typeAttributes),
            isFixed,
            properties,
            this._forwardingRef
        );
    };

    getUnionType = (members: OrderedSet<TypeRef>): TypeRef => {
        return this.useBuilder().getUnionType(defined(this._typeAttributes), members, this._forwardingRef);
    };
}

export class GraphRewriteBuilder<T extends Type> extends TypeBuilder implements TypeLookerUp {
    private _setsToReplaceByMember: Map<number, Set<T>>;
    private _reconstitutedTypes: Map<number, TypeRef> = Map();

    constructor(
        private readonly _originalGraph: TypeGraph,
        stringTypeMapping: StringTypeMapping,
        alphabetizeProperties: boolean,
        setsToReplace: T[][],
        private readonly _replacer: (
            typesToReplace: Set<T>,
            builder: GraphRewriteBuilder<T>,
            forwardingRef: TypeRef
        ) => TypeRef
    ) {
        super(stringTypeMapping, alphabetizeProperties, false);
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

    private withForwardingRef(typeCreator: (forwardingRef: TypeRef) => TypeRef): TypeRef {
        const forwardingRef = new TypeRef(this.typeGraph, undefined, this);
        const actualRef = typeCreator(forwardingRef);
        forwardingRef.resolve(actualRef);
        return actualRef;
    }

    private replaceSet(typesToReplace: Set<T>): TypeRef {
        return this.withForwardingRef(forwardingRef => {
            typesToReplace.forEach(t => {
                const originalRef = t.typeRef;
                const index = originalRef.getIndex();
                this._reconstitutedTypes = this._reconstitutedTypes.set(index, forwardingRef);
                this._setsToReplaceByMember = this._setsToReplaceByMember.remove(index);
            });
            return this._replacer(typesToReplace, this, forwardingRef);
        });
    }

    private getReconstitutedType = (originalRef: TypeRef): TypeRef => {
        const index = originalRef.getIndex();
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
                new TypeReconstituter(this, this.alphabetizeProperties, originalNames, forwardingRef),
                this.getReconstitutedType
            );
        });
    };

    reconstituteType = (t: Type): TypeRef => {
        assert(t.typeRef.graph === this._originalGraph, "Trying to reconstitute a type from the wrong graph");
        return this.getReconstitutedType(t.typeRef);
    };

    lookupTypeRefs(typeRefs: TypeRef[]): TypeRef | undefined {
        assert(typeRefs.length >= 2, "Use lookupTypeRef to look up a single type");

        const maybeRef = this._reconstitutedTypes.get(typeRefs[0].getIndex());
        if (maybeRef !== undefined && maybeRef.maybeIndex !== undefined) {
            let allEqual = true;
            for (let i = 1; i < typeRefs.length; i++) {
                if (this._reconstitutedTypes.get(typeRefs[i].getIndex()) !== maybeRef) {
                    allEqual = false;
                    break;
                }
            }
            if (allEqual) {
                return maybeRef;
            }
        }

        const maybeSet = this._setsToReplaceByMember.get(typeRefs[0].getIndex());
        if (maybeSet === undefined) {
            return undefined;
        }
        for (let i = 1; i < typeRefs.length; i++) {
            if (this._setsToReplaceByMember.get(typeRefs[i].getIndex()) !== maybeSet) {
                return undefined;
            }
        }

        return this.reconstituteType(typeRefs[0].deref()[0]);
    }

    lookupTypeRef = (typeRef: TypeRef): TypeRef => {
        return this.reconstituteType(typeRef.deref()[0]);
    };

    lookupType = (typeRef: TypeRef): Type | undefined => {
        const tref = this.lookupTypeRef(typeRef);
        const maybeIndex = tref.maybeIndex;
        if (maybeIndex === undefined) return undefined;
        return this.types[maybeIndex];
    };

    finish(): TypeGraph {
        this._originalGraph.topLevels.forEach((t, name) => {
            this.addTopLevel(name, this.getReconstitutedType(t.typeRef));
        });
        return super.finish();
    }
}

export abstract class UnionBuilder<TBuilder extends TypeBuilder, TArray, TClass, TMap> {
    private _haveAny = false;
    private _haveNull = false;
    private _haveBool = false;
    private _haveInteger = false;
    private _haveDouble = false;
    private _stringTypes = OrderedSet<PrimitiveStringTypeKind>();
    private readonly _arrays: TArray[] = [];
    private readonly _maps: TMap[] = [];
    private readonly _classes: TClass[] = [];
    // FIXME: we're losing order here
    private _enumCaseMap: { [name: string]: number } = {};
    private _enumCases: string[] = [];

    constructor(
        protected readonly typeBuilder: TBuilder,
        protected readonly typeAttributes: TypeAttributes,
        private readonly _conflateNumbers: boolean,
        protected readonly forwardingRef?: TypeRef
    ) { }

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

    addEnumCase = (s: string, count: number = 1): void => {
        if (this.haveString) {
            return;
        }
        if (!Object.prototype.hasOwnProperty.call(this._enumCaseMap, s)) {
            this._enumCaseMap[s] = 0;
            this._enumCases.push(s);
        }
        this._enumCaseMap[s] += count;
    };
    addEnumCases = (cases: OrderedMap<string, number>): void => {
        cases.forEach((count, name) => this.addEnumCase(name, count));
    };

    protected abstract makeEnum(cases: string[], counts: { [name: string]: number }): TypeRef;
    protected abstract makeClass(classes: TClass[], maps: TMap[]): TypeRef;
    protected abstract makeArray(arrays: TArray[]): TypeRef;

    getMemberKinds(): TypeKind[] {
        if (this._haveAny) {
            return ["any"];
        }

        const members: TypeKind[] = [];

        if (this._haveNull)  members.push("null");
        if (this._haveBool) members.push("bool");
        if (this._haveDouble) members.push("double");
        if (this._haveInteger && !(this._conflateNumbers && this._haveDouble)) members.push("integer");
        this._stringTypes.forEach(kind => { members.push(kind); });
        if (this._enumCases.length > 0) members.push("enum");
        if (this._classes.length > 0 || this._maps.length > 0) members.push("class");
        if (this._arrays.length > 0) members.push("array");

        if (members.length === 0) {
            return ["none"];
        }
        return members;
    }

    private makeTypeOfKind(kind: TypeKind): TypeRef {
        // FIXME: forwarding ref only if it's the only type in the union
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
                return this.typeBuilder.getPrimitiveType(kind, this.forwardingRef);
            case "string":
                return this.typeBuilder.getStringType(this.typeAttributes, undefined, this.forwardingRef);
            case "enum":
                return this.makeEnum(this._enumCases, this._enumCaseMap);
            case "class":
                return this.makeClass(this._classes, this._maps);
            case "array":
                return this.makeArray(this._arrays);
            default:
                if (kind === "union" || kind === "map") {
                    return panic(`getMemberKinds() shouldn't return ${kind}`);
                }
                return assertNever(kind);
        }
    }

    buildUnion = (unique: boolean): TypeRef => {
        const kinds = this.getMemberKinds();

        if (kinds.length === 1) {
            const t = this.makeTypeOfKind(kinds[0]);
            this.typeBuilder.addAttributes(t, this.typeAttributes);
            return t;
        }

        const types: TypeRef[] = [];
        for (const kind of kinds) {
            types.push(this.makeTypeOfKind(kind));
        }
        const typesSet = OrderedSet(types);
        if (unique) {
            assert(this.forwardingRef === undefined, "Cannot build unique union type with forwarding ref"); // FIXME: why not?
            return this.typeBuilder.getUniqueUnionType(this.typeAttributes, typesSet);
        } else {
            return this.typeBuilder.getUnionType(this.typeAttributes, typesSet, this.forwardingRef);
        }
    };
}
