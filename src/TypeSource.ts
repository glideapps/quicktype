import { Readable } from "stream";

export type StringInput = string | Readable;

export interface JSONTypeSource {
    kind: "json";
    name: string;
    samples: StringInput[];
    description?: string;
}

export interface TypeScriptTypeSource {
    kind: "typescript";
    sources: { [filename: string]: string };
}

export interface SchemaTypeSource {
    kind: "schema";
    name: string;
    uris?: string[];
    schema?: StringInput;
}

export interface GraphQLTypeSource {
    kind: "graphql";
    name: string;
    schema: any;
    query: StringInput;
}

export type TypeSource = GraphQLTypeSource | JSONTypeSource | SchemaTypeSource | TypeScriptTypeSource;

export function isJSONSource(source: TypeSource): source is JSONTypeSource {
    return source.kind === "json";
}

export function isTypeScriptSource(source: TypeSource): source is TypeScriptTypeSource {
    return source.kind === "typescript";
}

export function isSchemaSource(source: TypeSource): source is SchemaTypeSource {
    return source.kind === "schema";
}

export function isGraphQLSource(source: TypeSource): source is GraphQLTypeSource {
    return source.kind === "graphql";
}
