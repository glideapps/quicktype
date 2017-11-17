"use strict";

import { OrderedSet, Set, Map, OrderedMap } from "immutable";
import * as pluralize from "pluralize";

import { Value, Tag, valueTag, CompressedJSON } from "./CompressedJSON";
import { Type, PrimitiveType, EnumType, MapType, ArrayType, ClassType, UnionType, makeNullable } from "./Type";
import { assertNever } from "./Support";
import { PrimitiveTypeKind } from "Reykjavik";

const MIN_LENGTH_FOR_ENUM = 10;

function concatArrays<T>(arrays: T[][]): T[] {
    let combined: T[] = [];
    for (let i = 0; i < arrays.length; i++) combined = combined.concat(arrays[i]);
    return combined;
}

export class TypeInference {
    // FIXME: make mutable?
    private _primitiveTypes: Map<PrimitiveTypeKind, PrimitiveType> = Map();
    private _mapTypes: Map<Type, MapType> = Map();
    private _arrayTypes: Map<Type, ArrayType> = Map();
    private _enumTypes: Map<OrderedSet<string>, EnumType> = Map();
    private _classTypes: Map<Map<string, Type>, ClassType> = Map();
    private _unionTypes: Map<OrderedSet<Type>, UnionType> = Map();

    constructor(private readonly _inferMaps: boolean, private readonly _inferEnums: boolean) {}

    private getPrimitiveType = (kind: PrimitiveTypeKind): PrimitiveType => {
        let t = this._primitiveTypes.get(kind);
        if (t === undefined) {
            t = new PrimitiveType(kind);
            this._primitiveTypes = this._primitiveTypes.set(kind, t);
        }
        return t;
    };

    private getEnumType = (name: string, cases: OrderedSet<string>): EnumType => {
        let t = this._enumTypes.get(cases);
        if (t === undefined) {
            t = new EnumType(name, cases);
            this._enumTypes = this._enumTypes.set(cases, t);
        } else {
            t.addName(name);
        }
        return t;
    };

    private getMapType = (values: Type): MapType => {
        let t = this._mapTypes.get(values);
        if (t === undefined) {
            t = new MapType(values);
            this._mapTypes = this._mapTypes.set(values, t);
        }
        return t;
    };

    private getArrayType = (items: Type): ArrayType => {
        let t = this._arrayTypes.get(items);
        if (t === undefined) {
            t = new ArrayType(items);
            this._arrayTypes = this._arrayTypes.set(items, t);
        }
        return t;
    };

    private getClassType = (name: string, properties: Map<string, Type>): ClassType => {
        let t = this._classTypes.get(properties);
        if (t === undefined) {
            t = new ClassType(name, properties);
            this._classTypes = this._classTypes.set(properties, t);
        } else {
            t.addName(name);
        }
        return t;
    };

    private getUnionType = (name: string, members: OrderedSet<Type>): UnionType => {
        let t = this._unionTypes.get(members);
        if (t === undefined) {
            t = new UnionType(name, members);
            this._unionTypes = this._unionTypes.set(members, t);
        } else {
            t.addName(name);
        }
        return t;
    };

    inferType = (cjson: CompressedJSON, typeName: string, valueArray: Value[]): Type => {
        let haveNull = false;
        let haveBool = false;
        let haveInteger = false;
        let haveDouble = false;
        let haveString = false;
        let enumCaseMap: { [name: string]: number } = {};
        let enumCases: string[] = [];
        const objects: Value[][] = [];
        const arrays: Value[][] = [];

        for (const value of valueArray) {
            const t = valueTag(value);
            switch (t) {
                case Tag.Null:
                    haveNull = true;
                    break;
                case Tag.False:
                case Tag.True:
                    haveBool = true;
                    break;
                case Tag.Integer:
                    haveInteger = true;
                    break;
                case Tag.Double:
                    haveDouble = true;
                    break;
                case Tag.InternedString:
                    if (!haveString && valueArray.length >= MIN_LENGTH_FOR_ENUM) {
                        const s = cjson.getStringForValue(value);
                        if (!Object.prototype.hasOwnProperty.call(enumCaseMap, s)) {
                            enumCaseMap[s] = 0;
                            enumCases.push(s);
                        }
                        enumCaseMap[s] += 1;
                    } else {
                        haveString = true;
                    }
                    break;
                case Tag.UninternedString:
                    if (!haveString) {
                        haveString = true;
                        enumCaseMap = {};
                        enumCases = [];
                    }
                    break;
                case Tag.Object:
                    objects.push(cjson.getObjectForValue(value));
                    break;
                case Tag.Array:
                    arrays.push(cjson.getArrayForValue(value));
                    break;
                default:
                    return assertNever(t);
            }
        }

        const types: Type[] = [];

        if (haveNull) {
            types.push(this.getPrimitiveType("null"));
        }
        if (haveBool) {
            types.push(this.getPrimitiveType("bool"));
        }
        if (haveDouble) {
            types.push(this.getPrimitiveType("double"));
        } else if (haveInteger) {
            types.push(this.getPrimitiveType("integer"));
        }
        if (this._inferEnums && enumCases.length > 0 && enumCases.length < Math.sqrt(valueArray.length)) {
            types.push(this.getEnumType(typeName, OrderedSet(enumCases)));
        } else if (enumCases.length > 0 || haveString) {
            types.push(this.getPrimitiveType("string"));
        }
        if (objects.length > 0) {
            types.push(this.inferClassType(cjson, typeName, objects));
        }
        if (arrays.length > 0) {
            const combined = concatArrays(arrays);
            types.push(this.getArrayType(this.inferType(cjson, pluralize.singular(typeName), combined)));
        }

        if (types.length === 0) {
            return this.getPrimitiveType("any");
        }
        if (types.length === 1) {
            return types[0];
        }
        return this.getUnionType(typeName, OrderedSet(types));
    };

    private inferClassType = (cjson: CompressedJSON, typeName: string, objects: Value[][]): Type => {
        const combined = concatArrays(objects);
        const propertyNames: string[] = [];
        const propertyValues: { [name: string]: Value[] } = {};

        for (let i = 0; i < combined.length; i += 2) {
            const key = cjson.getStringForValue(combined[i]);
            const value = combined[i + 1];
            if (!Object.prototype.hasOwnProperty.call(propertyValues, key)) {
                propertyNames.push(key);
                propertyValues[key] = [];
            }
            propertyValues[key].push(value);
        }

        const properties: [string, Type][] = [];
        let couldBeMap = this._inferMaps;
        for (const key of propertyNames) {
            const values = propertyValues[key];
            let t = this.inferType(cjson, key, values);
            if (values.length < objects.length) {
                t = makeNullable(t, key);
            }
            if (couldBeMap && properties.length > 0 && t !== properties[0][1]) {
                couldBeMap = false;
            }
            properties.push([key, t]);
        }

        if (couldBeMap && properties.length >= 20) {
            return this.getMapType(properties[0][1]);
        }
        return this.getClassType(typeName, OrderedMap(properties));
    };
}
