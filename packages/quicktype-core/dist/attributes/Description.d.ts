import { TypeAttributeKind } from "./TypeAttributes";
import { JSONSchemaType, Ref, JSONSchemaAttributes } from "../input/JSONSchemaInput";
import { JSONSchema } from "../input/JSONSchemaStore";
export declare function addDescriptionToSchema(schema: {
    [name: string]: unknown;
}, description: Iterable<string> | undefined): void;
export declare const descriptionTypeAttributeKind: TypeAttributeKind<ReadonlySet<string>>;
export declare const propertyDescriptionsTypeAttributeKind: TypeAttributeKind<Map<string, ReadonlySet<string>>>;
export declare function descriptionAttributeProducer(schema: JSONSchema, ref: Ref, types: Set<JSONSchemaType>): JSONSchemaAttributes | undefined;
