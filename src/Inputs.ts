import { Map } from "immutable";
import { getStream } from "./get-stream";
import { Readable } from "stream";

import { schemaForTypeScriptSources } from "./TypeScriptInput";
import { Ref, checkJSONSchema } from "./JSONSchemaInput";
import { Value } from "./CompressedJSON";
import { JSONSchemaStore, JSONSchema } from "./JSONSchemaStore";
import { parseJSON, panic } from "./Support";

const stringToStream = require("string-to-stream");

export type InputData = {
    samples: { [name: string]: { samples: Value[]; description?: string } };
    schemas: { [name: string]: { ref: Ref } };
    graphQLs: { [name: string]: { schema: any; query: string } };
};

export function toReadable(source: string | Readable): Readable {
    return typeof source === "string" ? stringToStream(source) : source;
}

export async function toString(source: string | Readable): Promise<string> {
    return typeof source === "string" ? source : await getStream(source);
}

export type StringInput = string | Readable;

export interface JSONTypeSource {
    kind: "json";
    name: string;
    samples: StringInput[];
    description?: string;
}

export function isJSONSource(source: TypeSource): source is JSONTypeSource {
    return source.kind === "json";
}

export interface TypeScriptTypeSource {
    kind: "typescript";
    sources: { [filename: string]: string };
}

export function isTypeScriptSource(source: TypeSource): source is TypeScriptTypeSource {
    return source.kind === "typescript";
}

export interface SchemaTypeSource {
    kind: "schema";
    name: string;
    uri?: string;
    schema?: StringInput;
    topLevelRefs?: string[];
}

export function isSchemaSource(source: TypeSource): source is SchemaTypeSource {
    return source.kind === "schema";
}

export function toSchemaSource(source: TypeSource): (SchemaTypeSource & { isDirectInput: boolean }) | undefined {
    if (isSchemaSource(source)) {
        return Object.assign({ isDirectInput: true }, source);
    } else if (isTypeScriptSource(source)) {
        return {
            kind: "schema",
            name: "",
            schema: schemaForTypeScriptSources(source.sources),
            topLevelRefs: ["/definitions/"],
            isDirectInput: false
        };
    }
    return undefined;
}

export interface GraphQLTypeSource {
    kind: "graphql";
    name: string;
    schema: any;
    query: StringInput;
}

export function isGraphQLSource(source: TypeSource): source is GraphQLTypeSource {
    return source.kind === "graphql";
}

export type TypeSource = GraphQLTypeSource | JSONTypeSource | SchemaTypeSource | TypeScriptTypeSource;

export class InputJSONSchemaStore extends JSONSchemaStore {
    constructor(private readonly _inputs: Map<string, StringInput>, private readonly _delegate?: JSONSchemaStore) {
        super();
    }

    async fetch(address: string): Promise<JSONSchema | undefined> {
        const maybeInput = this._inputs.get(address);
        if (maybeInput !== undefined) {
            return checkJSONSchema(parseJSON(await toString(maybeInput), "JSON Schema", address));
        }
        if (this._delegate === undefined) {
            return panic(`Schema URI ${address} requested, but no store given`);
        }
        return await this._delegate.fetch(address);
    }
}
