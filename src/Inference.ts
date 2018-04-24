"use strict";

import { OrderedMap, Map } from "immutable";

import { Value, Tag, valueTag, CompressedJSON } from "./CompressedJSON";
import { assertNever } from "./Support";
import { TypeBuilder, TypeRef } from "./TypeBuilder";
import { UnionBuilder, UnionAccumulator } from "./UnionBuilder";
import { isTime, isDateTime, isDate } from "./DateTime";
import { ClassProperty } from "./Type";
import { TypeAttributes, emptyTypeAttributes } from "./TypeAttributes";
import { StringTypes } from "./StringTypes";

// This should be the recursive type
//   Value[] | NestedValueArray[]
// but TypeScript doesn't support that.
export type NestedValueArray = any;

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

class InferenceUnionBuilder extends UnionBuilder<TypeBuilder, NestedValueArray, NestedValueArray> {
    constructor(
        typeBuilder: TypeBuilder,
        private readonly _typeInference: TypeInference,
        private readonly _cjson: CompressedJSON,
        private readonly _fixed: boolean
    ) {
        super(typeBuilder);
    }

    protected makeEnum(
        stringTypes: StringTypes,
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        return this.typeBuilder.getStringType(typeAttributes, stringTypes, forwardingRef);
    }

    protected makeObject(
        objects: NestedValueArray,
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        return this._typeInference.inferClassType(this._cjson, typeAttributes, objects, this._fixed, forwardingRef);
    }

    protected makeArray(
        arrays: NestedValueArray,
        _typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        return this.typeBuilder.getArrayType(
            this._typeInference.inferType(this._cjson, Map(), arrays, this._fixed, forwardingRef)
        );
    }
}

function canBeEnumCase(s: string): boolean {
    if (s.length === 0) return true; // FIXME: Do we really want this?
    return !isDate(s) && !isTime(s) && !isDateTime(s);
}

export class TypeInference {
    constructor(
        private readonly _typeBuilder: TypeBuilder,
        private readonly _inferEnums: boolean,
        private readonly _inferDates: boolean
    ) {}

    inferType(
        cjson: CompressedJSON,
        typeAttributes: TypeAttributes,
        valueArray: NestedValueArray,
        fixed: boolean,
        forwardingRef?: TypeRef
    ): TypeRef {
        const accumulator = new UnionAccumulator<NestedValueArray, NestedValueArray>(true);

        forEachValueInNestedValueArray(valueArray, value => {
            const t = valueTag(value);
            switch (t) {
                case Tag.Null:
                    accumulator.addNull(emptyTypeAttributes);
                    break;
                case Tag.False:
                case Tag.True:
                    accumulator.addBool(emptyTypeAttributes);
                    break;
                case Tag.Integer:
                    accumulator.addInteger(emptyTypeAttributes);
                    break;
                case Tag.Double:
                    accumulator.addDouble(emptyTypeAttributes);
                    break;
                case Tag.InternedString:
                    if (this._inferEnums) {
                        const s = cjson.getStringForValue(value);
                        if (canBeEnumCase(s)) {
                            accumulator.addEnumCase(s, 1, emptyTypeAttributes);
                        } else {
                            accumulator.addStringType("string", emptyTypeAttributes);
                        }
                    } else {
                        accumulator.addStringType("string", emptyTypeAttributes);
                    }
                    break;
                case Tag.UninternedString:
                    accumulator.addStringType("string", emptyTypeAttributes);
                    break;
                case Tag.Object:
                    accumulator.addObject(cjson.getObjectForValue(value), emptyTypeAttributes);
                    break;
                case Tag.Array:
                    accumulator.addArray(cjson.getArrayForValue(value), emptyTypeAttributes);
                    break;
                case Tag.Date:
                    accumulator.addStringType(this._inferDates ? "date" : "string", emptyTypeAttributes);
                    break;
                case Tag.Time:
                    accumulator.addStringType(this._inferDates ? "time" : "string", emptyTypeAttributes);
                    break;
                case Tag.DateTime:
                    accumulator.addStringType(this._inferDates ? "date-time" : "string", emptyTypeAttributes);
                    break;
                default:
                    return assertNever(t);
            }
        });

        const unionBuilder = new InferenceUnionBuilder(this._typeBuilder, this, cjson, fixed);
        return unionBuilder.buildUnion(accumulator, false, typeAttributes, forwardingRef);
    }

    inferClassType(
        cjson: CompressedJSON,
        typeAttributes: TypeAttributes,
        objects: NestedValueArray,
        fixed: boolean,
        forwardingRef?: TypeRef
    ): TypeRef {
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
            const t = this.inferType(cjson, Map(), values, false);
            const isOptional = values.length < objects.length;
            properties.push([key, new ClassProperty(t, isOptional)]);
        }

        const propertyMap = OrderedMap(properties);
        if (fixed) {
            return this._typeBuilder.getUniqueClassType(typeAttributes, true, propertyMap, forwardingRef);
        } else {
            return this._typeBuilder.getClassType(typeAttributes, propertyMap, forwardingRef);
        }
    }
}
