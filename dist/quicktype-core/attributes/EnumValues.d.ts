import { AccessorNames } from "./AccessorNames";
import { EnumType } from "../Type";
import { TypeAttributeKind } from "./TypeAttributes";
import { JSONSchema } from "../input/JSONSchemaStore";
import { Ref, JSONSchemaType, JSONSchemaAttributes } from "../input/JSONSchemaInput";
export declare const enumValuesTypeAttributeKind: TypeAttributeKind<AccessorNames>;
export declare function enumCaseValues(e: EnumType, language: string): Map<string, [string, boolean] | undefined>;
export declare function enumValuesAttributeProducer(schema: JSONSchema, _canonicalRef: Ref | undefined, _types: Set<JSONSchemaType>): JSONSchemaAttributes | undefined;
