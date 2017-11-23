"use strict";

import { Map, OrderedSet } from "immutable";

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

    getEnumType = (name: string, cases: OrderedSet<string>): EnumType => {
        let t = this._enumTypes.get(cases);
        if (t === undefined) {
            t = new EnumType(name, cases);
            this._enumTypes = this._enumTypes.set(cases, t);
        } else {
            t.addName(name);
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

    getClassType = (name: string, properties: Map<string, Type>): ClassType => {
        let t = this._classTypes.get(properties);
        if (t === undefined) {
            t = new ClassType(name, properties);
            this._classTypes = this._classTypes.set(properties, t);
        } else {
            t.addName(name);
        }
        return t;
    };

    getUnionType = (name: string, members: OrderedSet<Type>): UnionType => {
        let t = this._unionTypes.get(members);
        if (t === undefined) {
            t = new UnionType(name, members);
            this._unionTypes = this._unionTypes.set(members, t);
        } else {
            t.addName(name);
        }
        return t;
    };
}
