import { TypeAttributeKind, TypeAttributes } from "./TypeAttributes";
import { JSONSchemaType, JSONSchemaAttributes, Ref } from "../input/JSONSchemaInput";
import { JSONSchema } from "../input/JSONSchemaStore";
declare type URIAttributes = [ReadonlySet<string>, ReadonlySet<string>];
export declare const uriTypeAttributeKind: TypeAttributeKind<URIAttributes>;
export declare function uriInferenceAttributesProducer(s: string): TypeAttributes;
export declare function uriSchemaAttributesProducer(schema: JSONSchema, _ref: Ref, types: Set<JSONSchemaType>): JSONSchemaAttributes | undefined;
export {};
