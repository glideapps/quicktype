"use strict";

import { Map, OrderedSet, isIndexed } from "immutable";

import { Type, PrimitiveType, EnumType, MapType, ArrayType, ClassType, UnionType } from "./Type";
import { PrimitiveTypeKind } from "Reykjavik";

export class TypeBuilder {
    // FIXME: make mutable?
    private _primitiveTypes: Map<PrimitiveTypeKind, PrimitiveType> = Map();
    private _mapTypes: Map<Type, MapType> = Map();
    private _arrayTypes: Map<Type, ArrayType> = Map();
    private _enumTypes: Map<OrderedSet<string>, EnumType> = Map();
    private _classTypes: Map<Map<string, Type>, ClassType> = Map();
    private _unionTypes: Map<OrderedSet<Type>, UnionType> = Map();

    getPrimitiveType = (kind: PrimitiveTypeKind): PrimitiveType => {
        let t = this._primitiveTypes.get(kind);
        if (t === undefined) {
            t = new PrimitiveType(kind);
            this._primitiveTypes = this._primitiveTypes.set(kind, t);
        }
        return t;
    };

    getEnumType = (name: string, isInferred: boolean, cases: OrderedSet<string>): EnumType => {
        let t = this._enumTypes.get(cases);
        if (t === undefined) {
            t = new EnumType(name, isInferred, cases);
            this._enumTypes = this._enumTypes.set(cases, t);
        } else {
            t.addName(name, isInferred);
        }
        return t;
    };

    getMapType = (values: Type): MapType => {
        let t = this._mapTypes.get(values);
        if (t === undefined) {
            t = new MapType(values);
            this._mapTypes = this._mapTypes.set(values, t);
        }
        return t;
    };

    getArrayType = (items: Type): ArrayType => {
        let t = this._arrayTypes.get(items);
        if (t === undefined) {
            t = new ArrayType(items);
            this._arrayTypes = this._arrayTypes.set(items, t);
        }
        return t;
    };

    getClassType = (name: string, isInferred: boolean, properties: Map<string, Type>): ClassType => {
        let t = this._classTypes.get(properties);
        if (t === undefined) {
            t = new ClassType(name, isInferred, properties);
            this._classTypes = this._classTypes.set(properties, t);
        } else {
            t.addName(name, isInferred);
        }
        return t;
    };

    getUniqueClassType = (name: string, isInferred: boolean, properties?: Map<string, Type>): ClassType => {
        return new ClassType(name, isInferred, properties);
    };

    getUnionType = (name: string, isInferred: boolean, members: OrderedSet<Type>): UnionType => {
        let t = this._unionTypes.get(members);
        if (t === undefined) {
            t = new UnionType(name, isInferred, members);
            this._unionTypes = this._unionTypes.set(members, t);
        } else {
            t.addName(name, isInferred);
        }
        return t;
    };

    getUniqueUnionType = (name: string, isInferred: boolean, members: OrderedSet<Type>): UnionType => {
        return new UnionType(name, isInferred, members);
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
        protected readonly typeBuilder: TypeBuilder,
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
