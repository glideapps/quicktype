import { StringInput, JSONSourceData, JSONSchemaSourceData } from "quicktype-core";

export interface JSONTypeSource extends JSONSourceData {
    kind: "json";
}

export interface SchemaTypeSource extends JSONSchemaSourceData {
    kind: "schema";
}

export interface GraphQLTypeSource {
    kind: "graphql";
    name: string;
    schema: any;
    query: StringInput;
}

export type TypeSource = GraphQLTypeSource | JSONTypeSource | SchemaTypeSource;

export function isJSONSource(source: TypeSource): source is JSONTypeSource {
    return source.kind === "json";
}

export function isSchemaSource(source: TypeSource): source is SchemaTypeSource {
    return source.kind === "schema";
}

export function isGraphQLSource(source: TypeSource): source is GraphQLTypeSource {
    return source.kind === "graphql";
}
