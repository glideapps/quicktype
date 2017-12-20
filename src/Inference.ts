"use strict";

import { OrderedSet, OrderedMap } from "immutable";
import * as pluralize from "pluralize";

import { Value, Tag, valueTag, CompressedJSON } from "./CompressedJSON";
import { assertNever, assert, panic, defined } from "./Support";
import { TypeGraphBuilder, UnionBuilder, TypeRef } from "./TypeBuilder";
import { isTime, isDateTime, isDate } from "./DateTime";

const MIN_LENGTH_FOR_ENUM = 10;

// This should be the recursive type
//   Value[] | NestedValueArray[]
// but TypeScript doesn't support that.
type NestedValueArray = any;

function forEachArrayInNestedValueArray(va: NestedValueArray, f: (va: Value[]) => void): void {
    if (va.length === 0) {
        return;
    }
    if (Array.isArray(va[0])) {
        for (const x of va) {
            forEachArrayInNestedValueArray(x, f);
        }
    } else {
        f(va);
    }
}

function forEachValueInNestedValueArray(va: NestedValueArray, f: (v: Value) => void): void {
    forEachArrayInNestedValueArray(va, a => a.forEach(f));
}

class InferenceUnionBuilder extends UnionBuilder<NestedValueArray, NestedValueArray, any> {
    private _numValues?: number;

    constructor(
        typeBuilder: TypeGraphBuilder,
        typeName: string,
        isInferred: boolean,
        private readonly _typeInference: TypeInference,
        private readonly _cjson: CompressedJSON
    ) {
        super(typeBuilder, typeName, isInferred);
    }

    setNumValues = (n: number): void => {
        if (this._numValues !== undefined) {
            return panic("Can only set number of values once");
        }
        this._numValues = n;
    };

    protected makeEnum(enumCases: string[]): TypeRef | null {
        assert(enumCases.length > 0);
        const numValues = defined(this._numValues);
        if (numValues >= MIN_LENGTH_FOR_ENUM && enumCases.length < Math.sqrt(numValues)) {
            return this.typeBuilder.getEnumType(this.typeName, true, OrderedSet(enumCases));
        }
        return null;
    }

    protected makeClass(classes: NestedValueArray, maps: any[]): TypeRef {
        assert(maps.length === 0);
        return this._typeInference.inferClassType(this._cjson, this.typeName, this.isInferred, classes);
    }

    protected makeArray(arrays: NestedValueArray): TypeRef {
        return this.typeBuilder.getArrayType(
            this._typeInference.inferType(this._cjson, pluralize.singular(this.typeName), this.isInferred, arrays)
        );
    }
}

function canBeEnumCase(s: string): boolean {
    if (s.length === 0) return true; // FIXME: Do we really want this?
    return !isDate(s) && !isTime(s, false) && !isDateTime(s);
}

export class TypeInference {
    constructor(private readonly _typeBuilder: TypeGraphBuilder, private readonly _inferEnums: boolean) {}

    inferType = (
        cjson: CompressedJSON,
        typeName: string,
        isInferred: boolean,
        valueArray: NestedValueArray
    ): TypeRef => {
        const unionBuilder = new InferenceUnionBuilder(this._typeBuilder, typeName, isInferred, this, cjson);
        let numValues = 0;

        forEachValueInNestedValueArray(valueArray, value => {
            numValues += 1;
            const t = valueTag(value);
            switch (t) {
                case Tag.Null:
                    unionBuilder.addNull();
                    break;
                case Tag.False:
                case Tag.True:
                    unionBuilder.addBool();
                    break;
                case Tag.Integer:
                    unionBuilder.addInteger();
                    break;
                case Tag.Double:
                    unionBuilder.addDouble();
                    break;
                case Tag.InternedString:
                    if (this._inferEnums && !unionBuilder.haveString) {
                        const s = cjson.getStringForValue(value);
                        if (canBeEnumCase(s)) {
                            unionBuilder.addEnumCase(s);
                        } else {
                            unionBuilder.addStringType("string");
                        }
                    } else {
                        unionBuilder.addStringType("string");
                    }
                    break;
                case Tag.UninternedString:
                    unionBuilder.addStringType("string");
                    break;
                case Tag.Object:
                    unionBuilder.addClass(cjson.getObjectForValue(value));
                    break;
                case Tag.Array:
                    unionBuilder.addArray(cjson.getArrayForValue(value));
                    break;
                case Tag.Date:
                    unionBuilder.addStringType("date");
                    break;
                case Tag.Time:
                    unionBuilder.addStringType("time");
                    break;
                case Tag.DateTime:
                    unionBuilder.addStringType("date-time");
                    break;
                default:
                    return assertNever(t);
            }
        });

        unionBuilder.setNumValues(numValues);
        return unionBuilder.buildUnion(false);
    };

    inferClassType = (
        cjson: CompressedJSON,
        typeName: string,
        isInferred: boolean,
        objects: NestedValueArray
    ): TypeRef => {
        const propertyNames: string[] = [];
        const propertyValues: { [name: string]: Value[] } = {};

        forEachArrayInNestedValueArray(objects, arr => {
            for (let i = 0; i < arr.length; i += 2) {
                const key = cjson.getStringForValue(arr[i]);
                const value = arr[i + 1];
                if (!Object.prototype.hasOwnProperty.call(propertyValues, key)) {
                    propertyNames.push(key);
                    propertyValues[key] = [];
                }
                propertyValues[key].push(value);
            }
        });

        const properties: [string, TypeRef][] = [];
        for (const key of propertyNames) {
            const values = propertyValues[key];
            let t = this.inferType(cjson, key, true, values);
            if (values.length < objects.length) {
                t = this._typeBuilder.makeNullable(t, key, true);
            }
            properties.push([key, t]);
        }

        const propertyMap = OrderedMap(properties);
        return this._typeBuilder.getClassType(typeName, isInferred, propertyMap);
    };
}
