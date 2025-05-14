import {
    StringTypes,
    inferTransformedStringTypeKindForString,
} from "../attributes/StringTypes";
import {
    type TypeAttributes,
    emptyTypeAttributes,
} from "../attributes/TypeAttributes";
import { messageError } from "../Messages";
import { assert, assertNever, defined, panic } from "../support/Support";
import {
    ArrayType,
    type ClassProperty,
    ClassType,
    MapType,
    UnionType,
    transformedStringTypeTargetTypeKindsMap,
} from "../Type";
import { type TypeBuilder } from "../Type/TypeBuilder";
import { type TypeRef, derefTypeRef } from "../Type/TypeRef";
import { nullableFromUnion } from "../Type/TypeUtils";
import { UnionAccumulator, UnionBuilder } from "../UnionBuilder";

import {
    type CompressedJSON,
    Tag,
    type Value,
    valueTag,
} from "./CompressedJSON";

// This should be the recursive type
//   Value[] | NestedValueArray[]
// but TypeScript doesn't support that.
// FIXME: reactor this
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NestedValueArray = any;

function forEachArrayInNestedValueArray(
    va: NestedValueArray,
    f: (va: Value[]) => void,
): void {
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

function forEachValueInNestedValueArray(
    va: NestedValueArray,
    f: (v: Value) => void,
): void {
    forEachArrayInNestedValueArray(va, (a) => {
        for (const x of a) {
            f(x);
        }
    });
}

class InferenceUnionBuilder extends UnionBuilder<
    TypeBuilder,
    NestedValueArray,
    NestedValueArray
> {
    public constructor(
        typeBuilder: TypeBuilder,
        private readonly _typeInference: TypeInference,
        private readonly _fixed: boolean,
    ) {
        super(typeBuilder);
    }

    protected makeObject(
        objects: NestedValueArray,
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined,
    ): TypeRef {
        return this._typeInference.inferClassType(
            typeAttributes,
            objects,
            this._fixed,
            forwardingRef,
        );
    }

    protected makeArray(
        arrays: NestedValueArray,
        typeAttributes: TypeAttributes,
        forwardingRef: TypeRef | undefined,
    ): TypeRef {
        return this.typeBuilder.getArrayType(
            typeAttributes,
            this._typeInference.inferType(
                emptyTypeAttributes,
                arrays,
                this._fixed,
                forwardingRef,
            ),
        );
    }
}

function canBeEnumCase(_s: string): boolean {
    return true;
}

export type Accumulator = UnionAccumulator<NestedValueArray, NestedValueArray>;

export class TypeInference {
    private _refIntersections: Array<[TypeRef, string[]]> | undefined;

    public constructor(
        private readonly _cjson: CompressedJSON<unknown>,
        private readonly _typeBuilder: TypeBuilder,
        private readonly _inferMaps: boolean,
        private readonly _inferEnums: boolean,
    ) {}

    private addValuesToAccumulator(
        valueArray: NestedValueArray,
        accumulator: Accumulator,
    ): void {
        forEachValueInNestedValueArray(valueArray, (value) => {
            const t = valueTag(value);
            switch (t) {
                case Tag.Null:
                    accumulator.addPrimitive("null", emptyTypeAttributes);
                    break;
                case Tag.False:
                case Tag.True:
                    accumulator.addPrimitive("bool", emptyTypeAttributes);
                    break;
                case Tag.Integer:
                    accumulator.addPrimitive("integer", emptyTypeAttributes);
                    break;
                case Tag.Double:
                    accumulator.addPrimitive("double", emptyTypeAttributes);
                    break;
                case Tag.InternedString:
                    if (this._inferEnums) {
                        const s = this._cjson.getStringForValue(value);
                        if (canBeEnumCase(s)) {
                            accumulator.addStringCase(
                                s,
                                1,
                                emptyTypeAttributes,
                            );
                        } else {
                            accumulator.addStringType(
                                "string",
                                emptyTypeAttributes,
                            );
                        }
                    } else {
                        accumulator.addStringType(
                            "string",
                            emptyTypeAttributes,
                        );
                    }

                    break;
                case Tag.UninternedString:
                    accumulator.addStringType("string", emptyTypeAttributes);
                    break;
                case Tag.Object:
                    accumulator.addObject(
                        this._cjson.getObjectForValue(value),
                        emptyTypeAttributes,
                    );
                    break;
                case Tag.Array:
                    accumulator.addArray(
                        this._cjson.getArrayForValue(value),
                        emptyTypeAttributes,
                    );
                    break;
                case Tag.StringFormat: {
                    const kind = this._cjson.getStringFormatTypeKind(value);
                    accumulator.addStringType(
                        "string",
                        emptyTypeAttributes,
                        new StringTypes(new Map(), new Set([kind])),
                    );
                    break;
                }

                case Tag.TransformedString: {
                    const s = this._cjson.getStringForValue(value);
                    const kind = inferTransformedStringTypeKindForString(
                        s,
                        this._cjson.dateTimeRecognizer,
                    );
                    if (kind === undefined) {
                        return panic("TransformedString does not have a kind");
                    }

                    const producer = defined(
                        transformedStringTypeTargetTypeKindsMap.get(kind),
                    ).attributesProducer;
                    if (producer === undefined) {
                        return panic(
                            "TransformedString does not have attribute producer",
                        );
                    }

                    accumulator.addStringType(
                        "string",
                        producer(s),
                        new StringTypes(new Map(), new Set([kind])),
                    );
                    break;
                }

                default:
                    return assertNever(t);
            }
        });
    }

    public inferType(
        typeAttributes: TypeAttributes,
        valueArray: NestedValueArray,
        fixed: boolean,
        forwardingRef?: TypeRef,
    ): TypeRef {
        const accumulator = this.accumulatorForArray(valueArray);
        return this.makeTypeFromAccumulator(
            accumulator,
            typeAttributes,
            fixed,
            forwardingRef,
        );
    }

    private resolveRef(ref: string, topLevel: TypeRef): TypeRef {
        if (!ref.startsWith("#/")) {
            return messageError("InferenceJSONReferenceNotRooted", {
                reference: ref,
            });
        }

        const parts = ref.split("/").slice(1);
        const graph = this._typeBuilder.typeGraph;
        let tref = topLevel;
        for (const part of parts) {
            let t = derefTypeRef(tref, graph);
            if (t instanceof UnionType) {
                const nullable = nullableFromUnion(t);
                if (nullable === null) {
                    // FIXME: handle unions
                    return messageError("InferenceJSONReferenceToUnion", {
                        reference: ref,
                    });
                }

                t = nullable;
            }

            if (t instanceof ClassType) {
                const cp = t.getProperties().get(part);
                if (cp === undefined) {
                    return messageError("InferenceJSONReferenceWrongProperty", {
                        reference: ref,
                    });
                }

                tref = cp.typeRef;
            } else if (t instanceof MapType) {
                tref = t.values.typeRef;
            } else if (t instanceof ArrayType) {
                if (/^[0-9]+$/.exec(part) === null) {
                    return messageError(
                        "InferenceJSONReferenceInvalidArrayIndex",
                        { reference: ref },
                    );
                }

                tref = t.items.typeRef;
            } else {
                return messageError("InferenceJSONReferenceWrongProperty", {
                    reference: ref,
                });
            }
        }

        return tref;
    }

    public inferTopLevelType(
        typeAttributes: TypeAttributes,
        valueArray: NestedValueArray,
        fixed: boolean,
    ): TypeRef {
        assert(
            this._refIntersections === undefined,
            "Didn't reset ref intersections - nested invocations?",
        );
        if (this._cjson.handleRefs) {
            this._refIntersections = [];
        }

        const topLevel = this.inferType(typeAttributes, valueArray, fixed);
        if (this._cjson.handleRefs) {
            for (const [tref, refs] of defined(this._refIntersections)) {
                const resolved = refs.map((r) => this.resolveRef(r, topLevel));
                this._typeBuilder.setSetOperationMembers(
                    tref,
                    new Set(resolved),
                );
            }

            this._refIntersections = undefined;
        }

        return topLevel;
    }

    private accumulatorForArray(valueArray: NestedValueArray): Accumulator {
        const accumulator = new UnionAccumulator<
            NestedValueArray,
            NestedValueArray
        >(true);
        this.addValuesToAccumulator(valueArray, accumulator);
        return accumulator;
    }

    private makeTypeFromAccumulator(
        accumulator: Accumulator,
        typeAttributes: TypeAttributes,
        fixed: boolean,
        forwardingRef?: TypeRef,
    ): TypeRef {
        const unionBuilder = new InferenceUnionBuilder(
            this._typeBuilder,
            this,
            fixed,
        );
        return unionBuilder.buildUnion(
            accumulator,
            false,
            typeAttributes,
            forwardingRef,
        );
    }

    public inferClassType(
        typeAttributes: TypeAttributes,
        objects: NestedValueArray,
        fixed: boolean,
        forwardingRef?: TypeRef,
    ): TypeRef {
        const propertyNames: string[] = [];
        const propertyValues: { [name: string]: Value[] } = {};

        forEachArrayInNestedValueArray(objects, (arr) => {
            for (let i = 0; i < arr.length; i += 2) {
                const key = this._cjson.getStringForValue(arr[i]);
                const value = arr[i + 1];
                if (
                    !Object.prototype.hasOwnProperty.call(propertyValues, key)
                ) {
                    propertyNames.push(key);
                    propertyValues[key] = [];
                }

                propertyValues[key].push(value);
            }
        });

        if (
            this._cjson.handleRefs &&
            propertyNames.length === 1 &&
            propertyNames[0] === "$ref"
        ) {
            const values = propertyValues.$ref;
            if (values.every((v) => valueTag(v) === Tag.InternedString)) {
                const allRefs = values.map((v) =>
                    this._cjson.getStringForValue(v),
                );
                // FIXME: Add is-ref attribute
                const tref = this._typeBuilder.getUniqueIntersectionType(
                    typeAttributes,
                    undefined,
                );
                defined(this._refIntersections).push([tref, allRefs]);
                return tref;
            }
        }

        if (this._inferMaps && propertyNames.length > 500) {
            const accumulator = new UnionAccumulator<
                NestedValueArray,
                NestedValueArray
            >(true);
            for (const key of propertyNames) {
                this.addValuesToAccumulator(propertyValues[key], accumulator);
            }

            const values = this.makeTypeFromAccumulator(
                accumulator,
                emptyTypeAttributes,
                fixed,
            );
            return this._typeBuilder.getMapType(
                typeAttributes,
                values,
                forwardingRef,
            );
        }

        const properties = new Map<string, ClassProperty>();
        for (const key of propertyNames) {
            const values = propertyValues[key];
            const t = this.inferType(emptyTypeAttributes, values, false);
            const isOptional = values.length < objects.length;
            properties.set(
                key,
                this._typeBuilder.makeClassProperty(t, isOptional),
            );
        }

        if (fixed) {
            return this._typeBuilder.getUniqueClassType(
                typeAttributes,
                true,
                properties,
                forwardingRef,
            );
        } else {
            return this._typeBuilder.getClassType(
                typeAttributes,
                properties,
                forwardingRef,
            );
        }
    }
}
