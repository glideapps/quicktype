import { Readable } from "stream";

export type StringInput = string | Readable;

export interface JSONTypeSource {
    kind: "json";
    name: string;
    samples: StringInput[];
    description?: string;
}

export interface SchemaTypeSource {
    kind: "schema";
    name: string;
    uris?: string[];
    schema?: StringInput;
    isConverted?: boolean;
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
