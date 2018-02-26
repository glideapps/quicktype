"use strict";

import { OrderedMap, Map } from "immutable";

import { Value, Tag, valueTag, CompressedJSON } from "./CompressedJSON";
import { assertNever, assert } from "./Support";
import { TypeBuilder, UnionBuilder, TypeRef, UnionAccumulator } from "./TypeBuilder";
import { isTime, isDateTime, isDate } from "./DateTime";
import { ClassProperty } from "./Type";
import { TypeAttributes } from "./TypeAttributes";

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

class InferenceUnionBuilder extends UnionBuilder<TypeBuilder, NestedValueArray, NestedValueArray, any> {
    constructor(
        typeBuilder: TypeBuilder,
        private readonly _typeInference: TypeInference,
        private readonly _cjson: CompressedJSON,
        private readonly _fixed: boolean
    ) {
        super(typeBuilder);
    }

    protected makeEnum(
        cases: string[],
        counts: { [name: string]: number },
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        const caseMap = OrderedMap(cases.map((c: string): [string, number] => [c, counts[c]]));
        return this.typeBuilder.getStringType(typeAttributes, caseMap, forwardingRef);
    }

    protected makeClass(
        classes: NestedValueArray,
        maps: any[],
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined
    ): TypeRef {
        assert(maps.length === 0);
        return this._typeInference.inferClassType(this._cjson, typeAttributes, classes, this._fixed, forwardingRef);
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
        const accumulator = new UnionAccumulator<NestedValueArray, NestedValueArray, any>(true);

        forEachValueInNestedValueArray(valueArray, value => {
            const t = valueTag(value);
            switch (t) {
                case Tag.Null:
                    accumulator.addNull();
                    break;
                case Tag.False:
                case Tag.True:
                    accumulator.addBool();
                    break;
                case Tag.Integer:
                    accumulator.addInteger();
                    break;
                case Tag.Double:
                    accumulator.addDouble();
                    break;
                case Tag.InternedString:
                    if (this._inferEnums && !accumulator.haveString) {
                        const s = cjson.getStringForValue(value);
                        if (canBeEnumCase(s)) {
                            accumulator.addEnumCase(s);
                        } else {
                            accumulator.addStringType("string");
                        }
                    } else {
                        accumulator.addStringType("string");
                    }
                    break;
                case Tag.UninternedString:
                    accumulator.addStringType("string");
                    break;
                case Tag.Object:
                    accumulator.addClass(cjson.getObjectForValue(value));
                    break;
                case Tag.Array:
                    accumulator.addArray(cjson.getArrayForValue(value));
                    break;
                case Tag.Date:
                    accumulator.addStringType(this._inferDates ? "date" : "string");
                    break;
                case Tag.Time:
                    accumulator.addStringType(this._inferDates ? "time" : "string");
                    break;
                case Tag.DateTime:
                    accumulator.addStringType(this._inferDates ? "date-time" : "string");
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
