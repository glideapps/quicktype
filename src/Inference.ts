"use strict";

import { OrderedMap } from "immutable";

import { Value, Tag, valueTag, CompressedJSON } from "./CompressedJSON";
import { assertNever, assert, panic } from "./Support";
import { TypeBuilder, UnionBuilder, TypeRef } from "./TypeBuilder";
import { isTime, isDateTime, isDate } from "./DateTime";
import { makeTypeNames, TypeNames } from "./TypeNames";
import { ClassProperty } from "./Type";

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

class InferenceUnionBuilder extends UnionBuilder<TypeBuilder, NestedValueArray, NestedValueArray, any> {
    private _numValues?: number;

    constructor(
        typeBuilder: TypeBuilder,
        typeNames: TypeNames,
        private readonly _typeInference: TypeInference,
        private readonly _cjson: CompressedJSON,
        forwardingRef?: TypeRef
    ) {
        super(typeBuilder, typeNames, true, forwardingRef);
    }

    setNumValues = (n: number): void => {
        if (this._numValues !== undefined) {
            return panic("Can only set number of values once");
        }
        this._numValues = n;
    };

    protected makeEnum(cases: string[], counts: { [name: string]: number }): TypeRef {
        const caseMap = OrderedMap(cases.map((c: string): [string, number] => [c, counts[c]]));
        return this.typeBuilder.getStringType(this.typeNames, caseMap, this.forwardingRef);
    }

    protected makeClass(classes: NestedValueArray, maps: any[]): TypeRef {
        assert(maps.length === 0);
        return this._typeInference.inferClassType(this._cjson, this.typeNames, classes, this.forwardingRef);
    }

    protected makeArray(arrays: NestedValueArray): TypeRef {
        return this.typeBuilder.getArrayType(
            this._typeInference.inferType(this._cjson, this.typeNames.singularize(), arrays, this.forwardingRef)
        );
    }
}

function canBeEnumCase(s: string): boolean {
    if (s.length === 0) return true; // FIXME: Do we really want this?
    return !isDate(s) && !isTime(s) && !isDateTime(s);
}

export class TypeInference {
    constructor(private readonly _typeBuilder: TypeBuilder, private readonly _inferEnums: boolean) {}

    inferType = (
        cjson: CompressedJSON,
        typeNames: TypeNames,
        valueArray: NestedValueArray,
        forwardingRef?: TypeRef
    ): TypeRef => {
        const unionBuilder = new InferenceUnionBuilder(this._typeBuilder, typeNames, this, cjson, forwardingRef);
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
        typeNames: TypeNames,
        objects: NestedValueArray,
        forwardingRef?: TypeRef
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

        const properties: [string, ClassProperty][] = [];
        for (const key of propertyNames) {
            const values = propertyValues[key];
            const t = this.inferType(cjson, makeTypeNames(key, true), values);
            const isOptional = values.length < objects.length;
            properties.push([key, new ClassProperty(t, isOptional)]);
        }

        const propertyMap = OrderedMap(properties);
        return this._typeBuilder.getClassType(typeNames, propertyMap, forwardingRef);
    };
}
