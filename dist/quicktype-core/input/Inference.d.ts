import { CompressedJSON } from "./CompressedJSON";
import { TypeBuilder } from "../TypeBuilder";
import { UnionAccumulator } from "../UnionBuilder";
import { TypeAttributes } from "../attributes/TypeAttributes";
import { TypeRef } from "../TypeGraph";
export declare type NestedValueArray = any;
export declare type Accumulator = UnionAccumulator<NestedValueArray, NestedValueArray>;
export declare class TypeInference {
    private readonly _cjson;
    private readonly _typeBuilder;
    private readonly _inferMaps;
    private readonly _inferEnums;
    private _refIntersections;
    constructor(_cjson: CompressedJSON<unknown>, _typeBuilder: TypeBuilder, _inferMaps: boolean, _inferEnums: boolean);
    addValuesToAccumulator(valueArray: NestedValueArray, accumulator: Accumulator): void;
    inferType(typeAttributes: TypeAttributes, valueArray: NestedValueArray, fixed: boolean, forwardingRef?: TypeRef): TypeRef;
    private resolveRef;
    inferTopLevelType(typeAttributes: TypeAttributes, valueArray: NestedValueArray, fixed: boolean): TypeRef;
    accumulatorForArray(valueArray: NestedValueArray): Accumulator;
    makeTypeFromAccumulator(accumulator: Accumulator, typeAttributes: TypeAttributes, fixed: boolean, forwardingRef?: TypeRef): TypeRef;
    inferClassType(typeAttributes: TypeAttributes, objects: NestedValueArray, fixed: boolean, forwardingRef?: TypeRef): TypeRef;
}
