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
    SeparatedNamedTypes,
    separateNamedTypes
} from "./Type";
import { defined, assert } from "./Support";

export class TypeGraph {
    // FIXME: OrderedMap?  We lose the order in PureScript right now, though,
    // and maybe even earlier in the TypeScript driver.
    private _topLevels: Map<string, number> = Map();

    private _types: List<Type> = List();

    // FIXME: make mutable?
    private _primitiveTypes: Map<PrimitiveTypeKind, PrimitiveType> = Map();
    private _mapTypes: Map<Type, MapType> = Map();
    private _arrayTypes: Map<Type, ArrayType> = Map();
    private _enumTypes: Map<OrderedSet<string>, EnumType> = Map();
    private _classTypes: Map<Map<string, Type>, ClassType> = Map();
    private _unionTypes: Map<OrderedSet<Type>, UnionType> = Map();

    get topLevels(): Map<string, Type> {
        return this._topLevels.map(this.typeAtIndex);
    }

    addTopLevel = (name: string, t: Type): void => {
        assert(t.typeGraph === this, "Adding top-level to wrong type graph");
        assert(!this._topLevels.has(name), "Trying to add top-level with existing name");
        this._topLevels = this._topLevels.set(name, t.indexInGraph);
    };

    addType = (t: Type): number => {
        const index = this._types.size;
        this._types = this._types.push(t);
        return index;
    };

    typeAtIndex = (index: number): Type => {
        return defined(this._types.get(index));
    };

    getPrimitiveType = (kind: PrimitiveTypeKind): PrimitiveType => {
        let t = this._primitiveTypes.get(kind);
        if (t === undefined) {
            t = new PrimitiveType(this, kind);
            this._primitiveTypes = this._primitiveTypes.set(kind, t);
        }
        return t;
    };

    getEnumType = (names: NameOrNames, isInferred: boolean, cases: OrderedSet<string>): EnumType => {
        let t = this._enumTypes.get(cases);
        if (t === undefined) {
            t = new EnumType(this, names, isInferred, cases);
            this._enumTypes = this._enumTypes.set(cases, t);
        } else {
            t.addNames(names, isInferred);
        }
        return t;
    };

    getMapType = (values: Type): MapType => {
        let t = this._mapTypes.get(values);
        if (t === undefined) {
            t = new MapType(this, values);
            this._mapTypes = this._mapTypes.set(values, t);
        }
        return t;
    };

    getArrayType = (items: Type): ArrayType => {
        let t = this._arrayTypes.get(items);
        if (t === undefined) {
            t = new ArrayType(this, items);
            this._arrayTypes = this._arrayTypes.set(items, t);
        }
        return t;
    };

    getClassType = (names: NameOrNames, isInferred: boolean, properties: Map<string, Type>): ClassType => {
        let t = this._classTypes.get(properties);
        if (t === undefined) {
            t = new ClassType(this, names, isInferred, properties);
            this._classTypes = this._classTypes.set(properties, t);
        } else {
            t.addNames(names, isInferred);
        }
        return t;
    };

    getUniqueClassType = (names: NameOrNames, isInferred: boolean, properties?: Map<string, Type>): ClassType => {
        return new ClassType(this, names, isInferred, properties);
    };

    getUnionType = (names: NameOrNames, isInferred: boolean, members: OrderedSet<Type>): UnionType => {
        let t = this._unionTypes.get(members);
        if (t === undefined) {
            t = new UnionType(this, names, isInferred, members);
            this._unionTypes = this._unionTypes.set(members, t);
        } else {
            t.addNames(names, isInferred);
        }
        return t;
    };

    getUniqueUnionType = (name: string, isInferred: boolean, members: OrderedSet<Type>): UnionType => {
        return new UnionType(this, name, isInferred, members);
    };

    filterTypes<T extends Type>(
        predicate: (t: Type) => t is T,
        childrenOfType?: (t: Type) => Collection<any, Type>
    ): OrderedSet<T> {
        let seen = Set<Type>();
        let types = List<T>();

        function addFromType(t: Type): void {
            if (seen.has(t)) return;
            seen = seen.add(t);

            const children = childrenOfType ? childrenOfType(t) : t.children;
            children.forEach(addFromType);
            if (predicate(t)) {
                types = types.push(t);
            }
        }

        this.topLevels.forEach(addFromType);
        return types.reverse().toOrderedSet();
    }

    allNamedTypes = (childrenOfType?: (t: Type) => Collection<any, Type>): OrderedSet<NamedType> => {
        return this.filterTypes<NamedType>((t: Type): t is NamedType => t.isNamedType(), childrenOfType);
    };

    allNamedTypesSeparated = (childrenOfType?: (t: Type) => Collection<any, Type>): SeparatedNamedTypes => {
        const types = this.allNamedTypes(childrenOfType);
        return separateNamedTypes(types);
    };

    // FIXME: Replace with a non-mutating solution.  It should look something like this:
    //
    // inputs:
    //    replacementGroups: Type[][]
    //    replacer: (group: Type[], builder: TypeBuilder): Type
    //
    // Each array in `replacementGroups` is a bunch of types to be replaced by a
    // single new type.  `replacer` is a function that takes a group and a
    // TypeBuilder, and builds a new type with that builder that replaces the group.
    // That particular TypeBuilder will have to take as inputs types in the old
    // graph, but return types in the new graph.  Recursive types must be handled
    // carefully.
    alter = (f: (t: Type) => Type): void => {
        this._topLevels = this.topLevels.map(t => f(t).indexInGraph);
    };
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
        protected readonly typeBuilder: TypeGraph,
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

    protected abstract makeEnum(cases: string[]): Type | null;
    protected abstract makeClass(classes: TClass[], maps: TMap[]): Type;
    protected abstract makeArray(arrays: TArray[]): Type;

    buildUnion = (unique: boolean): Type => {
        const types: Type[] = [];

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
