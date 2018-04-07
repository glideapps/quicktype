import * as lodash from "lodash";
import { Map } from "immutable";
import { getStream } from "./get-stream";
import { Readable } from "stream";

import { schemaForTypeScriptSources } from "./TypeScriptInput";
import { Ref, checkJSONSchema } from "./JSONSchemaInput";
import { Value, CompressedJSON } from "./CompressedJSON";
import { JSONSchemaStore, JSONSchema } from "./JSONSchemaStore";
import { parseJSON, panic, assertNever } from "./Support";
import { messageAssert, ErrorMessage } from "./Messages";

const stringToStream = require("string-to-stream");

function toReadable(source: string | Readable): Readable {
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

function isJSONSource(source: TypeSource): source is JSONTypeSource {
    return source.kind === "json";
}

export interface TypeScriptTypeSource {
    kind: "typescript";
    sources: { [filename: string]: string };
}

function isTypeScriptSource(source: TypeSource): source is TypeScriptTypeSource {
    return source.kind === "typescript";
}

export interface SchemaTypeSource {
    kind: "schema";
    name: string;
    uri?: string;
    schema?: StringInput;
    topLevelRefs?: string[];
}

function isSchemaSource(source: TypeSource): source is SchemaTypeSource {
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

function isGraphQLSource(source: TypeSource): source is GraphQLTypeSource {
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

export class InputData {
    private readonly _samples: { [name: string]: { samples: Value[]; description?: string } } = {};
    private readonly _schemas: { [name: string]: { ref: Ref } } = {};
    private readonly _graphQLs: { [name: string]: { schema: any; query: string } } = {};

    constructor(private readonly _compressedJSON: CompressedJSON) {
    }

    get jsonInputs(): Map<string, { samples: Value[]; description?: string }> {
        return Map(this._samples);
    }

    get schemaInputs(): Map<string, Ref> {
        return Map(this._schemas).map(({ ref }) => ref);
    }

    get graphQLInputs(): Map<string, { schema: any; query: string }> {
        return Map(this._graphQLs);
    }

    addSchemaInput(name: string, ref: Ref): void {
        messageAssert(!lodash.has(this._schemas, [name]), ErrorMessage.MoreThanOneSchemaGiven, { name });
        this._schemas[name] = { ref };
    }

    // Returns whether we need IR for this type source
    async addTypeSource(source: TypeSource): Promise<boolean> {
        if (isGraphQLSource(source)) {
            const { name, schema, query } = source;
            this._graphQLs[name] = { schema, query: await toString(query) };

            return true;
        } else if (isJSONSource(source)) {
            const { name, samples, description } = source;
            for (const sample of samples) {
                const input = await this._compressedJSON.readFromStream(toReadable(sample));
                if (!lodash.has(this._samples, [name])) {
                    this._samples[name] = { samples: [] };
                }
                this._samples[name].samples.push(input);
                if (description !== undefined) {
                    this._samples[name].description = description;
                }
            }

            return true;
        } else if (isSchemaSource(source) || isTypeScriptSource(source)) {
            return false;
        }
        return assertNever(source);
    }
}
