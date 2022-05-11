import { Type, TypeKind } from "../Type";
import { TypeAttributeKind } from "./TypeAttributes";
import { JSONSchemaType, JSONSchemaAttributes, Ref } from "../input/JSONSchemaInput";
import { JSONSchema } from "../input/JSONSchemaStore";
export declare type MinMaxConstraint = [number | undefined, number | undefined];
export declare class MinMaxConstraintTypeAttributeKind extends TypeAttributeKind<MinMaxConstraint> {
    private _typeKinds;
    private _minSchemaProperty;
    private _maxSchemaProperty;
    constructor(name: string, _typeKinds: Set<TypeKind>, _minSchemaProperty: string, _maxSchemaProperty: string);
    readonly inIdentity: boolean;
    combine(arr: MinMaxConstraint[]): MinMaxConstraint | undefined;
    intersect(arr: MinMaxConstraint[]): MinMaxConstraint | undefined;
    makeInferred(_: MinMaxConstraint): undefined;
    addToSchema(schema: {
        [name: string]: unknown;
    }, t: Type, attr: MinMaxConstraint): void;
    stringify([min, max]: MinMaxConstraint): string;
}
export declare const minMaxTypeAttributeKind: TypeAttributeKind<MinMaxConstraint>;
export declare const minMaxLengthTypeAttributeKind: TypeAttributeKind<MinMaxConstraint>;
export declare function minMaxAttributeProducer(schema: JSONSchema, _ref: Ref, types: Set<JSONSchemaType>): JSONSchemaAttributes | undefined;
export declare function minMaxLengthAttributeProducer(schema: JSONSchema, _ref: Ref, types: Set<JSONSchemaType>): JSONSchemaAttributes | undefined;
export declare function minMaxValueForType(t: Type): MinMaxConstraint | undefined;
export declare function minMaxLengthForType(t: Type): MinMaxConstraint | undefined;
export declare class PatternTypeAttributeKind extends TypeAttributeKind<string> {
    constructor();
    readonly inIdentity: boolean;
    combine(arr: string[]): string;
    intersect(_arr: string[]): string | undefined;
    makeInferred(_: string): undefined;
    addToSchema(schema: {
        [name: string]: unknown;
    }, t: Type, attr: string): void;
}
export declare const patternTypeAttributeKind: TypeAttributeKind<string>;
export declare function patternAttributeProducer(schema: JSONSchema, _ref: Ref, types: Set<JSONSchemaType>): JSONSchemaAttributes | undefined;
export declare function patternForType(t: Type): string | undefined;
