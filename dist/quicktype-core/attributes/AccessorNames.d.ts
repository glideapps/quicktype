import { TypeAttributeKind, TypeAttributes } from "./TypeAttributes";
import { EnumType, UnionType, Type, ObjectType } from "../Type";
import { JSONSchema } from "../input/JSONSchemaStore";
import { Ref, JSONSchemaType, JSONSchemaAttributes } from "../input/JSONSchemaInput";
export declare type AccessorEntry = string | Map<string, string>;
export declare type AccessorNames = Map<string, AccessorEntry>;
export declare const accessorNamesTypeAttributeKind: TypeAttributeKind<AccessorNames>;
export declare function lookupKey(accessors: AccessorNames, key: string, language: string): [string, boolean] | undefined;
export declare function objectPropertyNames(o: ObjectType, language: string): Map<string, [string, boolean] | undefined>;
export declare function enumCaseNames(e: EnumType, language: string): Map<string, [string, boolean] | undefined>;
export declare function getAccessorName(names: Map<string, [string, boolean] | undefined>, original: string): [string | undefined, boolean];
export declare const unionIdentifierTypeAttributeKind: TypeAttributeKind<ReadonlySet<number>>;
export declare function makeUnionIdentifierAttribute(): TypeAttributes;
export declare const unionMemberNamesTypeAttributeKind: TypeAttributeKind<Map<number, AccessorEntry>>;
export declare function makeUnionMemberNamesAttribute(unionAttributes: TypeAttributes, entry: AccessorEntry): TypeAttributes;
export declare function unionMemberName(u: UnionType, member: Type, language: string): [string | undefined, boolean];
export declare function makeAccessorNames(x: any): AccessorNames;
export declare function accessorNamesAttributeProducer(schema: JSONSchema, canonicalRef: Ref, _types: Set<JSONSchemaType>, cases: JSONSchema[] | undefined): JSONSchemaAttributes | undefined;