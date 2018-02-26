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
    matchTypeExhaustive
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
    ) {}

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

    getUniqueUnionType(
        attributes: TypeAttributes,
        members: OrderedSet<TypeRef> | undefined,
        forwardingRef?: TypeRef
    ): TypeRef {
        return this.addType(forwardingRef, tref => new UnionType(tref, members), attributes);
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
    registerUnion(typeRefs: TypeRef[], reconstituted: TypeRef): void;
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

export class TypeGraphBuilder extends TypeBuilder {
    protected typeForEntry(entry: Type | undefined): Type | undefined {
        return entry;
    }

    getLazyMapType(valuesCreator: () => TypeRef | undefined): TypeRef {
        return this.addType(undefined, tref => new MapType(tref, valuesCreator()), undefined);
    }
}

export class TypeReconstituter {
    private _wasUsed: boolean = false;

    constructor(
        private readonly _typeBuilder: TypeBuilder,
        private readonly _makeClassUnique: boolean,
        private readonly _typeAttributes: TypeAttributes,
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
    private _reconstitutedUnions: Map<Set<TypeRef>, TypeRef> = Map();

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

    private replaceSet(typesToReplace: Set<T>): TypeRef {
        return this.withForwardingRef(undefined, forwardingRef => {
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
        return this.withForwardingRef(undefined, forwardingRef => {
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
        let maybeRef = this._reconstitutedTypes.get(typeRefs[0].getIndex());
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

        maybeRef = this._reconstitutedUnions.get(Set(typeRefs));
        if (maybeRef !== undefined) {
            return maybeRef;
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

// FIXME: This interface is badly designed.  All the properties
// should use immutable types, and getMemberKinds should be
// implementable using the interface, not be part of it.  That
// means we'll have to expose primitive types, too.
export interface UnionTypeProvider<TArray, TClass, TMap> {
    readonly arrays: TArray[];
    readonly maps: TMap[];
    readonly classes: TClass[];
    // FIXME: We're losing order here.
    enumCaseMap: { [name: string]: number };
    enumCases: string[];

    getMemberKinds(): TypeKind[];
}

export class UnionAccumulator<TArray, TClass, TMap> implements UnionTypeProvider<TArray, TClass, TMap> {
    private _haveAny = false;
    private _haveNull = false;
    private _haveBool = false;
    private _haveInteger = false;
    private _haveDouble = false;
    private _stringTypes = OrderedSet<PrimitiveStringTypeKind>();

    readonly arrays: TArray[] = [];
    readonly maps: TMap[] = [];
    readonly classes: TClass[] = [];
    // FIXME: we're losing order here
    enumCaseMap: { [name: string]: number } = {};
    enumCases: string[] = [];

    constructor(private readonly _conflateNumbers: boolean) {}

    get haveString(): boolean {
        return this._stringTypes.has("string");
    }

    addAny(): void {
        this._haveAny = true;
    }
    addNull(): void {
        this._haveNull = true;
    }
    addBool(): void {
        this._haveBool = true;
    }
    addInteger(): void {
        this._haveInteger = true;
    }
    addDouble(): void {
        this._haveDouble = true;
    }

    addStringType(kind: PrimitiveStringTypeKind): void {
        if (this._stringTypes.has(kind)) return;
        // string overrides all other string types, as well as enum
        if (kind === "string") {
            this._stringTypes = OrderedSet([kind]);
            this.enumCaseMap = {};
            this.enumCases = [];
        } else {
            if (this.haveString) return;
            this._stringTypes = this._stringTypes.add(kind);
        }
    }
    addArray(t: TArray): void {
        this.arrays.push(t);
    }
    addClass(t: TClass): void {
        this.classes.push(t);
    }
    addMap(t: TMap): void {
        this.maps.push(t);
    }

    addEnumCase(s: string, count: number = 1): void {
        if (this.haveString) {
            return;
        }
        if (!Object.prototype.hasOwnProperty.call(this.enumCaseMap, s)) {
            this.enumCaseMap[s] = 0;
            this.enumCases.push(s);
        }
        this.enumCaseMap[s] += count;
    }
    addEnumCases(cases: OrderedMap<string, number>): void {
        cases.forEach((count, name) => this.addEnumCase(name, count));
    }

    getMemberKinds(): TypeKind[] {
        if (this._haveAny) {
            return ["any"];
        }

        const members: TypeKind[] = [];

        if (this._haveNull) members.push("null");
        if (this._haveBool) members.push("bool");
        if (this._haveDouble) members.push("double");
        if (this._haveInteger && !(this._conflateNumbers && this._haveDouble)) members.push("integer");
        this._stringTypes.forEach(kind => {
            members.push(kind);
        });
        if (this.enumCases.length > 0) members.push("enum");
        if (this.classes.length > 0 || this.maps.length > 0) members.push("class");
        if (this.arrays.length > 0) members.push("array");

        if (members.length === 0) {
            return ["none"];
        }
        return members;
    }
}

export function addTypeToUnionAccumulator(ua: UnionAccumulator<TypeRef, TypeRef, TypeRef>, t: Type): void {
    matchTypeExhaustive(
        t,
        _noneType => {
            return;
        },
        _anyType => ua.addAny(),
        _nullType => ua.addNull(),
        _boolType => ua.addBool(),
        _integerType => ua.addInteger(),
        _doubleType => ua.addDouble(),
        stringType => {
            const enumCases = stringType.enumCases;
            if (enumCases === undefined) {
                ua.addStringType("string");
            } else {
                ua.addEnumCases(enumCases);
            }
        },
        arrayType => ua.addArray(arrayType.items.typeRef),
        classType => ua.addClass(classType.typeRef),
        mapType => ua.addMap(mapType.values.typeRef),
        // FIXME: We're not carrying counts, so this is not correct if we do enum
        // inference.  JSON Schema input uses this case, however, without enum
        // inference, which is fine, but still a bit ugly.
        enumType => enumType.cases.forEach(s => ua.addEnumCase(s)),
        unionType => unionType.members.forEach(m => addTypeToUnionAccumulator(ua, m)),
        _dateType => ua.addStringType("date"),
        _timeType => ua.addStringType("time"),
        _dateTimeType => ua.addStringType("date-time")
    );
}

export abstract class UnionBuilder<TBuilder extends TypeBuilder, TArray, TClass, TMap> {
    constructor(protected readonly typeBuilder: TBuilder) {}

    protected abstract makeEnum(
        cases: string[],
        counts: { [name: string]: number },
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef;
    protected abstract makeClass(
        classes: TClass[],
        maps: TMap[],
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef;
    protected abstract makeArray(
        arrays: TArray[],
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef;

    private makeTypeOfKind(
        typeProvider: UnionTypeProvider<TArray, TClass, TMap>,
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
            case "class":
                return this.makeClass(typeProvider.classes, typeProvider.maps, typeAttributes, forwardingRef);
            case "array":
                return this.makeArray(typeProvider.arrays, typeAttributes, forwardingRef);
            default:
                if (kind === "union" || kind === "map") {
                    return panic(`getMemberKinds() shouldn't return ${kind}`);
                }
                return assertNever(kind);
        }
    }

    buildUnion(
        typeProvider: UnionTypeProvider<TArray, TClass, TMap>,
        unique: boolean,
        typeAttributes: TypeAttributes,
        forwardingRef?: TypeRef
    ): TypeRef {
        const kinds = typeProvider.getMemberKinds();

        if (kinds.length === 1) {
            const t = this.makeTypeOfKind(typeProvider, kinds[0], typeAttributes, forwardingRef);
            return t;
        }

        const union = unique
            ? this.typeBuilder.getUniqueUnionType(typeAttributes, undefined, forwardingRef)
            : undefined;

        const types: TypeRef[] = [];
        for (const kind of kinds) {
            types.push(this.makeTypeOfKind(typeProvider, kind, Map(), undefined));
        }
        const typesSet = OrderedSet(types);
        if (union !== undefined) {
            this.typeBuilder.setUnionMembers(union, typesSet);
            return union;
        } else {
            return this.typeBuilder.getUnionType(typeAttributes, typesSet, forwardingRef);
        }
    }
}
