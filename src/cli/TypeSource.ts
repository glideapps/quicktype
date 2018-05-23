import { JSONSourceData, JSONSchemaSourceData } from "quicktype-core";
import { GraphQLSourceData } from "../quicktype-graphql-input";

export interface JSONTypeSource extends JSONSourceData {
    kind: "json";
}

export interface SchemaTypeSource extends JSONSchemaSourceData {
    kind: "schema";
}

export interface GraphQLTypeSource extends GraphQLSourceData {
    kind: "graphql";
}

export type TypeSource = GraphQLTypeSource | JSONTypeSource | SchemaTypeSource;
