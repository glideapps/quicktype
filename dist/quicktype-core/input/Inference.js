"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const CompressedJSON_1 = require("./CompressedJSON");
const Support_1 = require("../support/Support");
const UnionBuilder_1 = require("../UnionBuilder");
const Type_1 = require("../Type");
const TypeAttributes_1 = require("../attributes/TypeAttributes");
const StringTypes_1 = require("../attributes/StringTypes");
const TypeGraph_1 = require("../TypeGraph");
const Messages_1 = require("../Messages");
const TypeUtils_1 = require("../TypeUtils");
function forEachArrayInNestedValueArray(va, f) {
    if (va.length === 0) {
        return;
    }
    if (Array.isArray(va[0])) {
        for (const x of va) {
            forEachArrayInNestedValueArray(x, f);
        }
    }
    else {
        f(va);
    }
}
function forEachValueInNestedValueArray(va, f) {
    forEachArrayInNestedValueArray(va, a => {
        for (const x of a) {
            f(x);
        }
    });
}
class InferenceUnionBuilder extends UnionBuilder_1.UnionBuilder {
    constructor(typeBuilder, _typeInference, _fixed) {
        super(typeBuilder);
        this._typeInference = _typeInference;
        this._fixed = _fixed;
    }
    makeObject(objects, typeAttributes, forwardingRef) {
        return this._typeInference.inferClassType(typeAttributes, objects, this._fixed, forwardingRef);
    }
    makeArray(arrays, typeAttributes, forwardingRef) {
        return this.typeBuilder.getArrayType(typeAttributes, this._typeInference.inferType(TypeAttributes_1.emptyTypeAttributes, arrays, this._fixed, forwardingRef));
    }
}
function canBeEnumCase(_s) {
    return true;
}
class TypeInference {
    constructor(_cjson, _typeBuilder, _inferMaps, _inferEnums) {
        this._cjson = _cjson;
        this._typeBuilder = _typeBuilder;
        this._inferMaps = _inferMaps;
        this._inferEnums = _inferEnums;
    }
    addValuesToAccumulator(valueArray, accumulator) {
        forEachValueInNestedValueArray(valueArray, value => {
            const t = CompressedJSON_1.valueTag(value);
            switch (t) {
                case CompressedJSON_1.Tag.Null:
                    accumulator.addPrimitive("null", TypeAttributes_1.emptyTypeAttributes);
                    break;
                case CompressedJSON_1.Tag.False:
                case CompressedJSON_1.Tag.True:
                    accumulator.addPrimitive("bool", TypeAttributes_1.emptyTypeAttributes);
                    break;
                case CompressedJSON_1.Tag.Integer:
                    accumulator.addPrimitive("integer", TypeAttributes_1.emptyTypeAttributes);
                    break;
                case CompressedJSON_1.Tag.Double:
                    accumulator.addPrimitive("double", TypeAttributes_1.emptyTypeAttributes);
                    break;
                case CompressedJSON_1.Tag.InternedString:
                    if (this._inferEnums) {
                        const s = this._cjson.getStringForValue(value);
                        if (canBeEnumCase(s)) {
                            accumulator.addStringCase(s, 1, TypeAttributes_1.emptyTypeAttributes);
                        }
                        else {
                            accumulator.addStringType("string", TypeAttributes_1.emptyTypeAttributes);
                        }
                    }
                    else {
                        accumulator.addStringType("string", TypeAttributes_1.emptyTypeAttributes);
                    }
                    break;
                case CompressedJSON_1.Tag.UninternedString:
                    accumulator.addStringType("string", TypeAttributes_1.emptyTypeAttributes);
                    break;
                case CompressedJSON_1.Tag.Object:
                    accumulator.addObject(this._cjson.getObjectForValue(value), TypeAttributes_1.emptyTypeAttributes);
                    break;
                case CompressedJSON_1.Tag.Array:
                    accumulator.addArray(this._cjson.getArrayForValue(value), TypeAttributes_1.emptyTypeAttributes);
                    break;
                case CompressedJSON_1.Tag.StringFormat: {
                    const kind = this._cjson.getStringFormatTypeKind(value);
                    accumulator.addStringType("string", TypeAttributes_1.emptyTypeAttributes, new StringTypes_1.StringTypes(new Map(), new Set([kind])));
                    break;
                }
                case CompressedJSON_1.Tag.TransformedString: {
                    const s = this._cjson.getStringForValue(value);
                    const kind = StringTypes_1.inferTransformedStringTypeKindForString(s, this._cjson.dateTimeRecognizer);
                    if (kind === undefined) {
                        return Support_1.panic("TransformedString does not have a kind");
                    }
                    const producer = Support_1.defined(Type_1.transformedStringTypeTargetTypeKindsMap.get(kind)).attributesProducer;
                    if (producer === undefined) {
                        return Support_1.panic("TransformedString does not have attribute producer");
                    }
                    accumulator.addStringType("string", producer(s), new StringTypes_1.StringTypes(new Map(), new Set([kind])));
                    break;
                }
                default:
                    return Support_1.assertNever(t);
            }
        });
    }
    inferType(typeAttributes, valueArray, fixed, forwardingRef) {
        const accumulator = this.accumulatorForArray(valueArray);
        return this.makeTypeFromAccumulator(accumulator, typeAttributes, fixed, forwardingRef);
    }
    resolveRef(ref, topLevel) {
        if (!ref.startsWith("#/")) {
            return Messages_1.messageError("InferenceJSONReferenceNotRooted", { reference: ref });
        }
        const parts = ref.split("/").slice(1);
        const graph = this._typeBuilder.typeGraph;
        let tref = topLevel;
        for (const part of parts) {
            let t = TypeGraph_1.derefTypeRef(tref, graph);
            if (t instanceof Type_1.UnionType) {
                const nullable = TypeUtils_1.nullableFromUnion(t);
                if (nullable === null) {
                    // FIXME: handle unions
                    return Messages_1.messageError("InferenceJSONReferenceToUnion", { reference: ref });
                }
                t = nullable;
            }
            if (t instanceof Type_1.ClassType) {
                const cp = t.getProperties().get(part);
                if (cp === undefined) {
                    return Messages_1.messageError("InferenceJSONReferenceWrongProperty", { reference: ref });
                }
                tref = cp.typeRef;
            }
            else if (t instanceof Type_1.MapType) {
                tref = t.values.typeRef;
            }
            else if (t instanceof Type_1.ArrayType) {
                if (part.match("^[0-9]+$") === null) {
                    return Messages_1.messageError("InferenceJSONReferenceInvalidArrayIndex", { reference: ref });
                }
                tref = t.items.typeRef;
            }
            else {
                return Messages_1.messageError("InferenceJSONReferenceWrongProperty", { reference: ref });
            }
        }
        return tref;
    }
    inferTopLevelType(typeAttributes, valueArray, fixed) {
        Support_1.assert(this._refIntersections === undefined, "Didn't reset ref intersections - nested invocations?");
        if (this._cjson.handleRefs) {
            this._refIntersections = [];
        }
        const topLevel = this.inferType(typeAttributes, valueArray, fixed);
        if (this._cjson.handleRefs) {
            for (const [tref, refs] of Support_1.defined(this._refIntersections)) {
                const resolved = refs.map(r => this.resolveRef(r, topLevel));
                this._typeBuilder.setSetOperationMembers(tref, new Set(resolved));
            }
            this._refIntersections = undefined;
        }
        return topLevel;
    }
    accumulatorForArray(valueArray) {
        const accumulator = new UnionBuilder_1.UnionAccumulator(true);
        this.addValuesToAccumulator(valueArray, accumulator);
        return accumulator;
    }
    makeTypeFromAccumulator(accumulator, typeAttributes, fixed, forwardingRef) {
        const unionBuilder = new InferenceUnionBuilder(this._typeBuilder, this, fixed);
        return unionBuilder.buildUnion(accumulator, false, typeAttributes, forwardingRef);
    }
    inferClassType(typeAttributes, objects, fixed, forwardingRef) {
        const propertyNames = [];
        const propertyValues = {};
        forEachArrayInNestedValueArray(objects, arr => {
            for (let i = 0; i < arr.length; i += 2) {
                const key = this._cjson.getStringForValue(arr[i]);
                const value = arr[i + 1];
                if (!Object.prototype.hasOwnProperty.call(propertyValues, key)) {
                    propertyNames.push(key);
                    propertyValues[key] = [];
                }
                propertyValues[key].push(value);
            }
        });
        if (this._cjson.handleRefs && propertyNames.length === 1 && propertyNames[0] === "$ref") {
            const values = propertyValues["$ref"];
            if (values.every(v => CompressedJSON_1.valueTag(v) === CompressedJSON_1.Tag.InternedString)) {
                const allRefs = values.map(v => this._cjson.getStringForValue(v));
                // FIXME: Add is-ref attribute
                const tref = this._typeBuilder.getUniqueIntersectionType(typeAttributes, undefined);
                Support_1.defined(this._refIntersections).push([tref, allRefs]);
                return tref;
            }
        }
        if (this._inferMaps && propertyNames.length > 500) {
            const accumulator = new UnionBuilder_1.UnionAccumulator(true);
            for (const key of propertyNames) {
                this.addValuesToAccumulator(propertyValues[key], accumulator);
            }
            const values = this.makeTypeFromAccumulator(accumulator, TypeAttributes_1.emptyTypeAttributes, fixed);
            return this._typeBuilder.getMapType(typeAttributes, values, forwardingRef);
        }
        const properties = new Map();
        for (const key of propertyNames) {
            const values = propertyValues[key];
            const t = this.inferType(TypeAttributes_1.emptyTypeAttributes, values, false);
            const isOptional = values.length < objects.length;
            properties.set(key, this._typeBuilder.makeClassProperty(t, isOptional));
        }
        if (fixed) {
            return this._typeBuilder.getUniqueClassType(typeAttributes, true, properties, forwardingRef);
        }
        else {
            return this._typeBuilder.getClassType(typeAttributes, properties, forwardingRef);
        }
    }
}
exports.TypeInference = TypeInference;
