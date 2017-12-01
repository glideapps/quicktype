"use strict";

import { OrderedSet, Set, Map, OrderedMap } from "immutable";
import * as pluralize from "pluralize";

import { Value, Tag, valueTag, CompressedJSON } from "./CompressedJSON";
import { Type, PrimitiveType, EnumType, MapType, ArrayType, ClassType, UnionType } from "./Type";
import { assertNever, assert } from "./Support";
import { TypeGraphBuilder, UnionBuilder, TypeRef } from "./TypeBuilder";
import { shouldBeMap } from "./InferMaps";

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
    constructor(
        typeBuilder: TypeGraphBuilder,
        typeName: string,
        isInferred: boolean,
        private readonly _typeInference: TypeInference,
        private readonly _cjson: CompressedJSON,
        private readonly _numValues: number
    ) {
        super(typeBuilder, typeName, isInferred);
    }

    protected makeEnum(enumCases: string[]): TypeRef | null {
        assert(enumCases.length > 0);
        if (enumCases.length < Math.sqrt(this._numValues)) {
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

export class TypeInference {
    constructor(
        private readonly _typeBuilder: TypeGraphBuilder,
        private readonly _inferMaps: boolean,
        private readonly _inferEnums: boolean
    ) {}

    inferType = (
        cjson: CompressedJSON,
        typeName: string,
        isInferred: boolean,
        valueArray: NestedValueArray
    ): TypeRef => {
        const unionBuilder = new InferenceUnionBuilder(
            this._typeBuilder,
            typeName,
            isInferred,
            this,
            cjson,
            valueArray.length
        );

        forEachValueInNestedValueArray(valueArray, value => {
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
                    if (this._inferEnums && !unionBuilder.haveString && valueArray.length >= MIN_LENGTH_FOR_ENUM) {
                        const s = cjson.getStringForValue(value);
                        unionBuilder.addEnumCase(s);
                    } else {
                        unionBuilder.addString();
                    }
                    break;
                case Tag.UninternedString:
                    unionBuilder.addString();
                    break;
                case Tag.Object:
                    unionBuilder.addClass(cjson.getObjectForValue(value));
                    break;
                case Tag.Array:
                    unionBuilder.addArray(cjson.getArrayForValue(value));
                    break;
                default:
                    return assertNever(t);
            }
        });

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
